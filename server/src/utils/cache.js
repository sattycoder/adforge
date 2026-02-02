// User page cache utility
// Stores last 10 pages per user for 5 days (5 URLs × 2 devices)
// Now using Redis for persistence and performance

import { getRedisClient } from './redisClient.js'

const CACHE_PREFIX = 'page:'
const CACHE_TTL_SECONDS = 5 * 24 * 60 * 60 // 5 days
const MAX_CACHED_PAGES_PER_USER = 10 // 5 URLs × 2 devices (iPhone + MacBook)

// Generate cache key from URL and device
const getCacheKey = (userEmail, url, device) => {
  // Sanitize email for Redis key (replace @ and . with safe characters)
  const safeEmail = userEmail.replace(/[@.]/g, '_')
  return `${CACHE_PREFIX}${safeEmail}:${url}:${device}`
}

/**
 * Get cached page data if available
 * @param {string} userEmail - User email address
 * @param {string} url - Page URL
 * @param {string} device - Device type (iphone16, macbook-air)
 * @returns {Promise<object|null>} Cached data or null if not found/expired
 */
export const getCachedPage = async (userEmail, url, device) => {
  if (!userEmail) {
    return null
  }
  
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(userEmail, url, device)
    
    const cached = await redis.get(cacheKey)
    if (!cached) {
      return null
    }
    
    console.log(`✅ Cache hit for ${userEmail}: ${url} (${device})`)
    return JSON.parse(cached)
  } catch (error) {
    console.error('Redis get error:', error)
    return null // Graceful degradation
  }
}

/**
 * Save page data to cache
 * @param {string} userEmail - User email address
 * @param {string} url - Page URL
 * @param {string} device - Device type
 * @param {object} data - Page data to cache (screenshotUrl, adSlots, metadata, etc.)
 */
export const saveCachedPage = async (userEmail, url, device, data) => {
  if (!userEmail) {
    return
  }
  
  try {
    const redis = getRedisClient()
    const cacheKey = getCacheKey(userEmail, url, device)
    
    // Save with automatic TTL expiration
    await redis.setex(
      cacheKey,
      CACHE_TTL_SECONDS,
      JSON.stringify(data)
    )
    
    // Track user's cached pages for purge functionality
    const safeEmail = userEmail.replace(/[@.]/g, '_')
    const userPagesKey = `${CACHE_PREFIX}${safeEmail}:pages`
    await redis.sadd(userPagesKey, cacheKey)
    await redis.expire(userPagesKey, CACHE_TTL_SECONDS)
    
    console.log(`💾 Cached page for ${userEmail}: ${url} (${device})`)
  } catch (error) {
    console.error('Redis set error:', error)
    // Fail silently - caching is not critical
  }
}

/**
 * Clear cache for a specific user
 * @param {string} userEmail - User email address
 */
export const clearUserCache = async (userEmail) => {
  if (!userEmail) {
    return
  }
  
  try {
    const redis = getRedisClient()
    const safeEmail = userEmail.replace(/[@.]/g, '_')
    const userPagesKey = `${CACHE_PREFIX}${safeEmail}:pages`
    
    // Get all cached page keys for this user
    const pageKeys = await redis.smembers(userPagesKey)
    
    if (pageKeys.length > 0) {
      await redis.del(...pageKeys)
    }
    await redis.del(userPagesKey)
    
    console.log(`🗑️ Cleared cache for ${userEmail} (${pageKeys.length} pages)`)
  } catch (error) {
    console.error('Redis clear error:', error)
  }
}

/**
 * Get list of cached URLs for a user (for UI display)
 * @param {string} userEmail - User email address
 * @returns {Promise<array>} Array of cached URL entries with metadata
 */
export const getCachedUrls = async (userEmail) => {
  if (!userEmail) {
    return []
  }
  
  try {
    const redis = getRedisClient()
    const safeEmail = userEmail.replace(/[@.]/g, '_')
    const userPagesKey = `${CACHE_PREFIX}${safeEmail}:pages`
    
    // Get all cached page keys for this user
    const pageKeys = await redis.smembers(userPagesKey)
    
    const entries = []
    for (const key of pageKeys) {
      const ttl = await redis.ttl(key)
      if (ttl > 0) {
        // Extract URL and device from key pattern: page:user_email:url:device
        const parts = key.replace(`${CACHE_PREFIX}${safeEmail}:`, '').split(':')
        if (parts.length >= 2) {
          const device = parts[parts.length - 1]
          const url = parts.slice(0, -1).join(':')
          const ageInSeconds = CACHE_TTL_SECONDS - ttl
          entries.push({
            url,
            device,
            timestamp: Date.now() - (ageInSeconds * 1000),
            age: ageInSeconds * 1000,
            ageInDays: Math.floor(ageInSeconds / (60 * 60 * 24))
          })
        }
      }
    }
    
    return entries.sort((a, b) => b.timestamp - a.timestamp)
  } catch (error) {
    console.error('Error getting cached URLs:', error)
    return []
  }
}

