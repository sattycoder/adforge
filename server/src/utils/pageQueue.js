import { Queue, Worker } from 'bullmq'
import { getRedisClient } from './redisClient.js'
import { browserPool } from './browserPool.js'

/**
 * Page Rendering Queue System
 * 
 * Uses BullMQ (Redis-backed) to queue page rendering requests.
 * Ensures fair distribution and prevents resource exhaustion.
 * 
 * Flow:
 * 1. Request comes in → Added to queue
 * 2. Worker picks up job when context available
 * 3. Allocates browser context from pool
 * 4. Processes page rendering
 * 5. Releases context back to pool
 */

// Create Redis connection for BullMQ
const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null, // BullMQ handles retries
}

// Create queue (exported for job status checking)
export const pageQueue = new Queue('page-rendering', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // Don't retry failed jobs (user will retry manually)
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
    timeout: 300000, // 5 minutes timeout per job
  },
})

/**
 * Add a page rendering job to the queue
 * 
 * @param {Object} jobData - Job data
 * @param {string} jobData.url - URL to render
 * @param {string} jobData.device - Device type
 * @param {string} jobData.userEmail - User email (optional)
 * @param {Function} onJobCreated - Callback when job is created (receives job object)
 * @returns {Promise<{result: Object, cancel: Function}>} - Job result and cancellation function
 */
export async function enqueuePageRender(jobData, onJobCreated = null) {
  const { url, device, userEmail } = jobData

  // Sanitize job ID - BullMQ doesn't allow colons or other special chars
  // Replace invalid characters with underscores
  const sanitizeJobId = (str) => str.replace(/[^a-zA-Z0-9_-]/g, '_')
  // Add random suffix to prevent duplicate IDs for simultaneous requests
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const jobId = `${sanitizeJobId(userEmail || 'anonymous')}-${sanitizeJobId(url)}-${device}-${Date.now()}-${randomSuffix}`

  // Add job to queue
  const job = await pageQueue.add('render-page', {
    url,
    device,
    userEmail,
    timestamp: Date.now(),
    cancelled: false, // Flag for cancellation
  }, {
    jobId, // Unique job ID (sanitized)
    priority: userEmail ? 1 : 0, // Prioritize logged-in users
  })

  console.log(`📥 Job ${job.id} enqueued: ${url} (${device})`)

  // Call callback if provided (for cancellation support)
  if (onJobCreated) {
    onJobCreated(job)
  }

  // Create cancellation function
  const cancel = async () => {
    try {
      const state = await job.getState()
      if (state === 'waiting' || state === 'delayed') {
        await job.remove()
        console.log(`✅ Cancelled waiting job ${job.id}`)
      } else if (state === 'active') {
        // Mark job as cancelled (worker will check this)
        await job.updateData({ ...job.data, cancelled: true })
        console.log(`⚠️ Job ${job.id} is active, marked for cancellation`)
      }
    } catch (err) {
      console.error(`Error cancelling job ${job.id}:`, err.message)
    }
  }

  // Wait for job to complete using polling
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Job timeout: Page rendering took too long'))
    }, 300000) // 5 minutes - universal timeout

    // Poll for job completion
    const checkJob = async () => {
      try {
        const state = await job.getState()
        
        if (state === 'completed') {
          clearTimeout(timeout)
          // Fetch the job again to get the return value
          // BullMQ stores the return value in the job after completion
          try {
            const completedJob = await pageQueue.getJob(job.id)
            // The return value is stored in the returnvalue property
            const result = completedJob?.returnvalue
            if (result !== undefined) {
              resolve(result)
            } else {
              // If returnvalue is not set yet, wait a bit and try again
              setTimeout(checkJob, 100)
            }
          } catch (fetchError) {
            console.error('Error fetching completed job:', fetchError)
            // If we can't fetch, reject with error
            reject(new Error('Failed to retrieve job result'))
          }
        } else if (state === 'failed') {
          clearTimeout(timeout)
          // Fetch the job again to get the failed reason
          try {
            const failedJob = await pageQueue.getJob(job.id)
            const failedReason = failedJob?.failedReason || 'Job failed'
            reject(new Error(failedReason))
          } catch (fetchError) {
            reject(new Error('Job failed'))
          }
        } else {
          // Still processing (waiting, active, delayed), check again
          // Use adaptive polling: faster when job is active, slower when waiting
          const pollInterval = state === 'active' ? 200 : 500
          setTimeout(checkJob, pollInterval)
        }
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    }

    // Start checking after a short delay
    setTimeout(checkJob, 1000)
  })

  return { result, cancel }
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const waiting = await pageQueue.getWaitingCount()
  const active = await pageQueue.getActiveCount()
  const completed = await pageQueue.getCompletedCount()
  const failed = await pageQueue.getFailedCount()

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active + completed + failed,
  }
}

/**
 * Initialize queue worker (call this in server.js)
 * 
 * @param {Function} renderFunction - The actual page rendering function
 */
export function initializeQueueWorker(renderFunction) {
  console.log('🔧 Initializing Page Rendering Queue Worker...')

  const worker = new Worker(
    'page-rendering',
    async (job) => {
      const { url, device, userEmail, cancelled } = job.data
      
      // Check if job was cancelled before starting
      if (cancelled) {
        console.log(`⚠️ Job ${job.id} was cancelled before processing`)
        throw new Error('Job cancelled by client')
      }
      
      console.log(`🔄 Processing job ${job.id}: ${url} (${device})`)

      // Allocate browser context from pool
      const { context, contextId, release } = await browserPool.allocateContext()

      try {
        // Check for cancellation periodically during processing
        const checkCancellation = async () => {
          try {
            const currentJob = await pageQueue.getJob(job.id)
            if (currentJob?.data?.cancelled) {
              console.log(`⚠️ Job ${job.id} marked for cancellation during processing`)
              throw new Error('Job cancelled by client')
            }
          } catch (err) {
            // If job doesn't exist or other error, continue processing
            // (job might have been removed, but we'll finish gracefully)
          }
        }

        // Execute the actual rendering function with cancellation checks
        // We'll check cancellation at key points in renderFunction
        // For now, check before starting
        await checkCancellation()
        
        const result = await renderFunction({
          context,
          url,
          device,
          userEmail,
          onCancellationCheck: checkCancellation, // Pass cancellation checker to render function
          job, // Pass job object to allow updating step flags
        })

        // Final cancellation check before returning
        await checkCancellation()

        console.log(`✅ Job ${job.id} completed successfully`)
        return result
      } catch (error) {
        // Don't log cancellation as an error
        if (error.message === 'Job cancelled by client') {
          console.log(`⚠️ Job ${job.id} was cancelled during processing`)
        } else {
          console.error(`❌ Job ${job.id} failed:`, error.message)
        }
        throw error
      } finally {
        // Always release context back to pool
        release()
      }
    },
    {
      connection: redisConnection,
      concurrency: 10, // Process up to 10 jobs concurrently (matches pool size)
      limiter: {
        max: 10, // Max 10 concurrent jobs
        duration: 1000, // Per second
      },
    }
  )

  // Event handlers
  worker.on('completed', (job) => {
    console.log(`✅ Queue worker: Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`❌ Queue worker: Job ${job.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('❌ Queue worker error:', err.message)
  })

  console.log('✅ Page Rendering Queue Worker initialized')

  return worker
}

