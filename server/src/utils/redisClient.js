import Redis from 'ioredis'

let redisClient = null

/**
 * Get or create Redis client with connection pooling
 * Optimized for 10+ concurrent users
 * @returns {Redis} Redis client instance
 */
export const getRedisClient = () => {
  if (redisClient && redisClient.status === 'ready') {
    return redisClient
  }

  const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    
    // CONNECTION POOLING for concurrent users
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    
    // RETRY STRATEGY - don't block on temporary failures
    retryStrategy: (times) => {
      if (times > 10) {
        // Suppress retry limit error in test mode
        if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
        console.error('Redis retry limit exceeded')
        }
        return null // Stop retrying
      }
      const delay = Math.min(times * 50, 2000)
      return delay
    },
    
    // RECONNECTION - auto-reconnect without blocking requests
    reconnectOnError: (err) => {
      const targetError = 'READONLY'
      if (err.message.includes(targetError)) {
        return true // Reconnect on READONLY errors
      }
      return false
    },
    
    // PERFORMANCE TUNING
    lazyConnect: false, // Connect immediately on startup
    keepAlive: 30000, // Keep connection alive (30s)
    connectTimeout: 10000, // 10s connect timeout
    commandTimeout: 5000, // 5s command timeout (fast fail for cache)
    
    // MEMORY OPTIMIZATION
    dropBufferSupport: true, // We only use strings, not buffers
  }

  redisClient = new Redis(config)

  redisClient.on('connect', () => {
    console.log('✅ Redis connected (ready for concurrent users)')
  })

  redisClient.on('ready', () => {
    console.log('✅ Redis ready to accept commands')
  })

  redisClient.on('error', (err) => {
    // Suppress Redis errors in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
    console.error('❌ Redis error:', err.message)
    }
    // Don't crash the app - graceful degradation
  })

  redisClient.on('close', () => {
    // Suppress Redis warnings in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
    console.warn('⚠️ Redis connection closed')
    }
  })

  redisClient.on('reconnecting', () => {
    // Suppress Redis reconnection messages in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
    console.log('🔄 Redis reconnecting...')
    }
  })

  return redisClient
}

/**
 * Check if Redis is available (non-blocking)
 * @returns {boolean}
 */
export const isRedisAvailable = () => {
  return redisClient && redisClient.status === 'ready'
}

/**
 * Graceful shutdown with timeout
 */
export const closeRedis = async () => {
  if (redisClient) {
    try {
      // Wait max 5s for pending commands
      await Promise.race([
        redisClient.quit(),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ])
      redisClient = null
      console.log('✅ Redis disconnected gracefully')
    } catch (error) {
      console.error('Error closing Redis:', error)
      redisClient.disconnect() // Force disconnect
      redisClient = null
    }
  }
}
