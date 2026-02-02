import { getCachedPage, clearUserCache } from '../utils/cache.js'
import { pageQueue } from '../utils/pageQueue.js'
import { renderPageWithContext } from '../utils/pageRenderer.js'
import { browserPool } from '../utils/browserPool.js'
import fs from 'fs'
import path from 'path'

// Page Controller - Handles webpage loading, scrolling, and ad detection

export default {
  // Render webpage with Playwright, auto-scroll, detect ad slots, return metadata + screenshot
  renderPage: async (req, res) => {
    try {
      const { url, device, userEmail } = req.query
      
      if (!url || !device) {
        return res.status(400).json({
          success: false,
          message: 'URL and device parameters are required'
        })
      }

      // Check cache first if user email is provided
      if (userEmail) {
        const cachedData = await getCachedPage(userEmail, url, device)
        if (cachedData) {
          // Validate that screenshot file still exists before serving from cache
          // Screenshots are cleaned up after 6 hours, but cache persists for 5 days
          if (cachedData.screenshotUrl) {
            // Extract filename from screenshotUrl (e.g., "/screenshots/page-123.png" -> "page-123.png")
            const screenshotFilename = cachedData.screenshotUrl.replace(/^\/screenshots\//, '')
            const screenshotPath = path.join(process.cwd(), 'screenshots', screenshotFilename)
            
            if (fs.existsSync(screenshotPath)) {
              console.log(`📦 Serving from cache for ${userEmail}: ${url} (${device})`)
              return res.json({
                success: true,
                data: {
                  ...cachedData,
                  cached: true,
                  timestamp: new Date().toISOString()
                }
              })
            } else {
              // Screenshot file deleted, cache is invalid - clear it and continue to fresh render
              console.log(`⚠️ Cache found but screenshot file missing for ${userEmail}: ${url} (${device}), clearing cache and re-rendering...`)
              // Clear user cache so fresh render happens
              await clearUserCache(userEmail)
              // Continue to fresh render below
            }
          } else {
            // Cache exists but no screenshot URL - invalid cache, clear it
            console.log(`⚠️ Cache found but missing screenshotUrl for ${userEmail}: ${url} (${device}), clearing cache...`)
            await clearUserCache(userEmail)
            // Continue to fresh render below
          }
        }
      }

      console.log(`📥 Enqueuing page render: ${url} with device: ${device}`)

      // SOLUTION: Return job ID immediately, frontend will poll for status
      // This prevents 60s timeout by keeping connections short (< 5 seconds each)
      // Sanitize job ID
      const sanitizeJobId = (str) => str.replace(/[^a-zA-Z0-9_-]/g, '_')
      const randomSuffix = Math.random().toString(36).substring(2, 8)
      const jobId = `${sanitizeJobId(userEmail || 'anonymous')}-${sanitizeJobId(url)}-${device}-${Date.now()}-${randomSuffix}`

      // Add job to queue (don't wait for completion)
      const job = await pageQueue.add('render-page', {
        url,
        device,
        userEmail,
        timestamp: Date.now(),
        cancelled: false,
      }, {
        jobId,
        priority: userEmail ? 1 : 0,
      })

      console.log(`📥 Job ${job.id} enqueued: ${url} (${device})`)

      // Return job ID immediately - frontend will poll for status
      res.json({
        success: true,
        data: {
          jobId: job.id,
          status: 'queued',
          message: 'Job enqueued, use /jobStatus endpoint to check progress'
        }
      })

    } catch (error) {
      console.error('Error rendering page:', error)
      res.status(500).json({
        success: false,
        message: 'Error rendering webpage',
        error: error.message
      })
    }
  },

  // Get page info without full processing (for quick checks)
  getPageInfo: async (req, res) => {
    try {
      const { url, device } = req.query
      
      if (!url || !device) {
        return res.status(400).json({
          success: false,
          message: 'URL and device parameters are required'
        })
      }

      // Allocate context from pool for quick page info check
      const { context, release } = await browserPool.allocateContext()
      const page = await context.newPage()
      
      try {
        // Set viewport based on device
        const viewports = {
          'iphone16': { width: 393, height: 852, deviceScaleFactor: 1 },
          'macbook-air': { width: 1440, height: 900, deviceScaleFactor: 1 },
        }
        const viewport = viewports[device] || viewports['iphone16']
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
        
        const info = await page.evaluate(() => {
          return {
            title: document.title,
            url: window.location.href,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            scrollHeight: document.documentElement.scrollHeight
          }
        })

        res.json({
          success: true,
          data: info
        })

      } finally {
        await page.close()
        release() // Release context back to pool
      }

    } catch (error) {
      console.error('Error getting page info:', error)
      res.status(500).json({
        success: false,
        message: 'Error getting page info',
        error: error.message
      })
    }
  },

  // Check job status (for polling)
  getJobStatus: async (req, res) => {
    try {
      const { jobId } = req.query
      
      if (!jobId) {
        return res.status(400).json({
          success: false,
          message: 'Job ID is required'
        })
      }

      const job = await pageQueue.getJob(jobId)
      
      if (!job) {
        return res.status(404).json({
          success: false,
          message: 'Job not found'
        })
      }

      const state = await job.getState()
      
      if (state === 'completed') {
        const result = job.returnvalue
        res.json({
          success: true,
          data: {
            jobId,
            status: 'completed',
            result
          }
        })
      } else if (state === 'failed') {
        res.json({
          success: false,
          data: {
            jobId,
            status: 'failed',
            error: job.failedReason || 'Job failed'
          }
        })
      } else {
        // Still processing (waiting, active, delayed)
        // Include step completion flags from job data
        const jobData = job.data || {}
        res.json({
          success: true,
          data: {
            jobId,
            status: state, // 'waiting', 'active', 'delayed'
            message: `Job is ${state}`,
            step1Complete: jobData.step1Complete || false,
            step2Complete: jobData.step2Complete || false,
            step3Complete: jobData.step3Complete || false
          }
        })
      }
    } catch (error) {
      console.error('Error getting job status:', error)
      res.status(500).json({
        success: false,
        message: 'Error getting job status',
        error: error.message
      })
    }
  }
}
