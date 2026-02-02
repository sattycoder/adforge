import { chromium } from 'playwright'

/**
 * Browser Context Pool Manager
 * 
 * Manages a pool of isolated browser contexts for concurrent requests.
 * Each context is isolated (separate cookies, storage, etc.) but shares the same browser process.
 * 
 * Architecture:
 * - 1 Browser instance (shared)
 * - 10 Browser Contexts (isolated, one per concurrent user)
 * - Contexts are allocated/released on demand
 * - If all contexts are busy, requests wait in queue
 */
export class BrowserContextPool {
  constructor(maxContexts = 10) {
    this.maxContexts = maxContexts
    this.browser = null
    this.contexts = [] // Array of { context, inUse, allocatedAt, id }
    this.waitingQueue = [] // Array of { resolve, reject, timeout }
    this.contextCounter = 0
    this.stats = {
      totalAllocations: 0,
      totalReleases: 0,
      maxWaitTime: 0,
      averageWaitTime: 0,
      queueLength: 0
    }
  }

  /**
   * Initialize the browser and pre-create contexts
   */
  async init() {
    if (this.browser) {
      return // Already initialized
    }

    console.log(`🚀 Initializing Browser Context Pool (${this.maxContexts} contexts)...`)

    // Launch browser with optimized settings for production
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-ipc-flooding-protection',
        '--memory-pressure-off', // Reduce memory pressure
      ],
      timeout: 60000,
      ignoreHTTPSErrors: true,
    })

    // Pre-create all contexts for faster allocation
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
    
    for (let i = 0; i < this.maxContexts; i++) {
      const context = await this.browser.newContext({
        userAgent: ua,
        extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
        viewport: null, // Let individual pages set their own viewport
      })

      // Add init script to reduce automation signals
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      this.contexts.push({
        id: ++this.contextCounter,
        context,
        inUse: false,
        allocatedAt: null,
      })
    }

    console.log(`✅ Browser Context Pool initialized with ${this.maxContexts} contexts`)
  }

  /**
   * Check if browser and context are still valid
   * @param {Object} contextData - Context data object
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async isValidContext(contextData) {
    try {
      // Check if browser is still connected
      if (!this.browser || !this.browser.isConnected()) {
        return false
      }

      // Check if context is still valid by trying to get pages
      // If context is closed, this will throw an error
      const pages = contextData.context.pages()
      return true
    } catch (error) {
      console.warn(`⚠️ Context ${contextData.id} is invalid:`, error.message)
      return false
    }
  }

  /**
   * Recreate a single invalid context
   * @param {Object} contextData - The invalid context data
   */
  async recreateContext(contextData) {
    try {
      // Close the old context if it exists
      try {
        await contextData.context.close()
      } catch (err) {
        // Ignore errors closing invalid context
      }

      // Create new context
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
      const newContext = await this.browser.newContext({
        userAgent: ua,
        extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
        viewport: null,
      })

      // Add init script
      await newContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      // Update context data
      contextData.context = newContext
      console.log(`✅ Recreated context ${contextData.id}`)
    } catch (error) {
      console.error(`❌ Failed to recreate context ${contextData.id}:`, error.message)
      throw error
    }
  }

  /**
   * Allocate a browser context from the pool
   * If all contexts are busy, wait in queue
   * 
   * @param {number} timeout - Maximum wait time in ms (default: 5 minutes)
   * @returns {Promise<Object>} - { context, contextId, release }
   */
  async allocateContext(timeout = 300000) {
    await this.init() // Ensure pool is initialized

    // Ensure browser is still valid, reinitialize if needed
    if (!this.browser || !this.browser.isConnected()) {
      console.warn('⚠️ Browser disconnected, reinitializing pool...')
      this.browser = null
      this.contexts = []
      await this.init()
    }

    // Try to find an available context immediately
    let availableContext = this.contexts.find(ctx => !ctx.inUse)
    
    if (availableContext) {
      // Validate context before allocating
      const isValid = await this.isValidContext(availableContext)
      if (!isValid) {
        console.warn(`⚠️ Context ${availableContext.id} is invalid, recreating...`)
        try {
          await this.recreateContext(availableContext)
        } catch (error) {
          console.error(`❌ Failed to recreate context ${availableContext.id}, reinitializing pool...`)
          // If recreation fails, reinitialize entire pool
          this.browser = null
          this.contexts = []
          await this.init()
          availableContext = this.contexts.find(ctx => !ctx.inUse)
          if (!availableContext) {
            throw new Error('Failed to reinitialize browser pool')
          }
        }
      }

      availableContext.inUse = true
      availableContext.allocatedAt = Date.now()
      this.stats.totalAllocations++
      
      console.log(`📦 Context ${availableContext.id} allocated (${this.getActiveCount()}/${this.maxContexts} in use)`)
      
      return {
        context: availableContext.context,
        contextId: availableContext.id,
        release: async () => await this.releaseContext(availableContext.id)
      }
    }

    // All contexts are busy - wait in queue
    console.log(`⏳ All contexts busy (${this.maxContexts}/${this.maxContexts}), queuing request...`)
    
    const waitStartTime = Date.now()
    this.stats.queueLength = Math.max(this.stats.queueLength, this.waitingQueue.length + 1)

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve)
        if (index !== -1) {
          this.waitingQueue.splice(index, 1)
          reject(new Error(`Context allocation timeout after ${timeout}ms`))
        }
      }, timeout)

      this.waitingQueue.push({
        resolve: (contextData) => {
          clearTimeout(timeoutId)
          const waitTime = Date.now() - waitStartTime
          this.stats.maxWaitTime = Math.max(this.stats.maxWaitTime, waitTime)
          this.updateAverageWaitTime(waitTime)
          resolve(contextData)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
        timeout
      })

      // Try to process queue immediately (in case context was released)
      this.processQueue()
    })
  }

  /**
   * Release a context back to the pool
   * 
   * @param {number} contextId - The ID of the context to release
   */
  async releaseContext(contextId) {
    const contextData = this.contexts.find(ctx => ctx.id === contextId)
    
    if (!contextData) {
      console.warn(`⚠️ Attempted to release unknown context ${contextId}`)
      return
    }

    if (!contextData.inUse) {
      console.warn(`⚠️ Context ${contextId} was already released`)
      return
    }

    // Check if context is still valid before releasing
    const isValid = await this.isValidContext(contextData).catch(() => false)
    if (!isValid) {
      console.warn(`⚠️ Context ${contextId} is invalid when releasing, will be recreated on next allocation`)
      // Mark as not in use but don't try to close pages
      contextData.inUse = false
      contextData.allocatedAt = null
      this.stats.totalReleases++
      // Process queue - it will recreate the context when needed
      await this.processQueue()
      return
    }

    // Close all pages in this context to free memory
    // context.pages() returns an array directly, not a promise
    try {
      const pages = contextData.context.pages()
      // Close all pages in parallel for faster cleanup
      const closePromises = pages
        .filter(page => !page.isClosed())
        .map(page => page.close().catch(err => {
          console.warn(`⚠️ Error closing page in context ${contextId}:`, err.message)
        }))
      
      // Wait for all pages to close (with timeout)
      if (closePromises.length > 0) {
        Promise.race([
          Promise.all(closePromises),
          new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
        ]).catch(() => {
          // Ignore timeout errors, pages will be cleaned up eventually
        })
      }
    } catch (err) {
      console.warn(`⚠️ Error getting pages from context ${contextId}:`, err.message)
      // Context might be invalid, mark it for recreation
      contextData.inUse = false
      contextData.allocatedAt = null
      this.stats.totalReleases++
      await this.processQueue()
      return
    }

    contextData.inUse = false
    const usageTime = Date.now() - (contextData.allocatedAt || Date.now())
    contextData.allocatedAt = null
    this.stats.totalReleases++

    console.log(`✅ Context ${contextId} released (used for ${Math.round(usageTime / 1000)}s, ${this.getActiveCount()}/${this.maxContexts} in use)`)

    // Process waiting queue
    await this.processQueue()
  }

  /**
   * Process waiting queue and allocate contexts to waiting requests
   * Made async-safe to prevent race conditions
   */
  async processQueue() {
    // Use setImmediate to prevent blocking and allow other operations
    if (this._processingQueue) {
      return // Already processing
    }
    
    this._processingQueue = true
    
    // Process queue asynchronously to prevent blocking
    setImmediate(async () => {
      this._processingQueue = false
      
      while (this.waitingQueue.length > 0) {
        let availableContext = this.contexts.find(ctx => !ctx.inUse)
        
        if (!availableContext) {
          break // No available contexts
        }

        // Validate context before allocating
        const isValid = await this.isValidContext(availableContext)
        if (!isValid) {
          console.warn(`⚠️ Context ${availableContext.id} is invalid in queue, recreating...`)
          try {
            await this.recreateContext(availableContext)
          } catch (error) {
            console.error(`❌ Failed to recreate context ${availableContext.id}, skipping...`)
            // Remove invalid context from pool and try next one
            const index = this.contexts.indexOf(availableContext)
            if (index > -1) {
              this.contexts.splice(index, 1)
            }
            // Try to find another available context
            availableContext = this.contexts.find(ctx => !ctx.inUse)
            if (!availableContext) {
              break // No more available contexts
            }
          }
        }

        const waitingRequest = this.waitingQueue.shift()
        if (!waitingRequest) {
          break // Safety check
        }
        
        availableContext.inUse = true
        availableContext.allocatedAt = Date.now()
        this.stats.totalAllocations++

        console.log(`📦 Context ${availableContext.id} allocated from queue (${this.getActiveCount()}/${this.maxContexts} in use, ${this.waitingQueue.length} waiting)`)

        waitingRequest.resolve({
          context: availableContext.context,
          contextId: availableContext.id,
          release: async () => await this.releaseContext(availableContext.id)
        })
      }
    })
  }

  /**
   * Get number of active (in-use) contexts
   */
  getActiveCount() {
    return this.contexts.filter(ctx => ctx.inUse).length
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalContexts: this.maxContexts,
      activeContexts: this.getActiveCount(),
      availableContexts: this.maxContexts - this.getActiveCount(),
      queueLength: this.waitingQueue.length,
      ...this.stats
    }
  }

  /**
   * Update average wait time using exponential moving average for better precision
   */
  updateAverageWaitTime(waitTime) {
    const alpha = 0.1 // Smoothing factor (10% weight for new value)
    if (this.stats.totalAllocations === 1) {
      this.stats.averageWaitTime = waitTime
    } else {
      // Exponential moving average: more stable over time
      this.stats.averageWaitTime = (alpha * waitTime) + ((1 - alpha) * this.stats.averageWaitTime)
    }
  }

  /**
   * Close all contexts and browser
   */
  async close() {
    console.log('🛑 Closing Browser Context Pool...')

    // Reject all waiting requests
    this.waitingQueue.forEach(item => {
      item.reject(new Error('Browser pool is closing'))
    })
    this.waitingQueue = []

    // Close all contexts
    for (const contextData of this.contexts) {
      try {
        await contextData.context.close()
      } catch (error) {
        console.warn(`⚠️ Error closing context ${contextData.id}:`, error.message)
      }
    }
    this.contexts = []

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close()
      } catch (error) {
        console.warn('⚠️ Error closing browser:', error.message)
      }
      this.browser = null
    }

    console.log('✅ Browser Context Pool closed')
  }
}

// Singleton instance
export const browserPool = new BrowserContextPool(
  parseInt(process.env.BROWSER_POOL_SIZE || '10', 10)
)

