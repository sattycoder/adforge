import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import app from './app.js'
import { startCleanup } from './utils/cleanup.js'
import { closeRedis } from './utils/redisClient.js'
import { browserPool } from './utils/browserPool.js'
import { initializeQueueWorker } from './utils/pageQueue.js'
import { renderPageWithContext } from './utils/pageRenderer.js'

// Load environment variables
dotenv.config()

const PORT = process.env.PORT || 5000

// Initialize browser context pool and queue worker before starting server
async function initializeServices() {
  try {
    // Initialize browser context pool (10 contexts for 10 concurrent users)
    console.log('🚀 Initializing browser context pool...')
    await browserPool.init()
    console.log('✅ Browser context pool initialized')
    
    // Initialize queue worker (processes rendering jobs)
    console.log('🚀 Initializing queue worker...')
    const queueWorker = initializeQueueWorker(renderPageWithContext)
    console.log('✅ Queue worker initialized')
    
    return queueWorker
  } catch (error) {
    console.error('❌ Failed to initialize services:', error)
    process.exit(1)
  }
}

// Start server after services are initialized
async function startServer() {
  try {
    const queueWorker = await initializeServices()
    
// Start periodic cleanup (screenshots/uploads)
startCleanup()

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
      console.log(`📱 Ad Maker Campaign Preview API ready`)
    })
    
    // Configure HTTP server timeouts for long-running requests
    // Universal 5-minute timeout across frontend and backend
    const UNIVERSAL_TIMEOUT = 300000 // 5 minutes
    server.keepAliveTimeout = UNIVERSAL_TIMEOUT // 5 minutes - keep connections alive during processing
    server.headersTimeout = UNIVERSAL_TIMEOUT + 10000 // 5 minutes + 10s buffer - timeout for receiving headers
    server.requestTimeout = UNIVERSAL_TIMEOUT // 5 minutes - timeout for entire request
    server.timeout = UNIVERSAL_TIMEOUT // 5 minutes - socket timeout
    
    console.log('⚙️ HTTP server timeouts configured: 5 minutes (universal timeout)')
    
    // Store queueWorker for graceful shutdown
    return { server, queueWorker }
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
let server = null
let queueWorker = null

startServer().then(({ server: srv, queueWorker: qw }) => {
  server = srv
  queueWorker = qw
}).catch(err => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})

// Graceful shutdown handler
const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`)
  
  try {
    // Close queue worker
    if (queueWorker) {
      console.log('🛑 Closing queue worker...')
      await queueWorker.close()
    }
    
    // Close browser pool
    console.log('🛑 Closing browser pool...')
    await browserPool.close()
    
    // Close Redis connection
    await closeRedis()
    
    // Close Express server
    if (server) {
      server.close(() => {
        console.log('✅ Server closed')
        process.exit(0)
      })
      
      // Force exit after 10 seconds if server doesn't close
      setTimeout(() => {
        console.error('⚠️ Forced shutdown after timeout')
        process.exit(1)
      }, 10000)
    } else {
      console.log('✅ Shutdown complete (server was not started)')
      process.exit(0)
    }
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
}

// Listen for termination signals
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
