import { fileUtils } from './fileUtils.js'
import { setPreConsentCookies } from './consent.js'
import { findAndClickConsentWithClaude, findAndClosePopupsWithClaude } from './claudeConsent.js'
import { detectAdsWithClaude } from './claudeAdDetection.js'
import { saveCachedPage } from './cache.js'
import { autoScroll, eagerLoadLazyResources } from './autoScroll.js'
import { captureHeaderAsync } from './headerCapture.js'
import fs from 'fs'
import { sleep } from './sleep.js'
import path from 'path'

/**
 * Core page rendering function
 * This is called by the queue worker with an allocated browser context
 * 
 * @param {Object} params
 * @param {BrowserContext} params.context - Playwright browser context (from pool)
 * @param {string} params.url - URL to render
 * @param {string} params.device - Device type
 * @param {string} params.userEmail - User email (optional)
 * @returns {Promise<Object>} - Rendering result
 */
export async function renderPageWithContext({ context, url, device, userEmail, onCancellationCheck = null, job = null }) {
  // Initialize comprehensive timing object
  const timings = {
    start: Date.now(),
    navigation: 0,
    headerCapture: 0,
    initialWait: 0,
    topAdTriggering: 0,
    frameMonitoring: 0,
    consentFirstAttempt: 0,
    eagerLoading: 0,
    autoScroll: 0,
    networkIdle: 0,
    contentReadiness: 0,
    consentSecondAttempt: 0,
    popupClosing: 0,
    adDetectionSelector: 0,
    adDetectionClaude: 0,
    screenshot: 0,
    total: 0
  }
  
  // Store headerInfo at function scope so it's accessible throughout
  let headerInfo = null
  
  // Create a new page from the allocated context
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(90000)
  page.setDefaultTimeout(90000)
  
  // Track scroll count for error reporting
  let scrollCount = 0

  try {
      // Set viewport based on device
      const viewports = {
        'iphone16': { width: 393, height: 852, deviceScaleFactor: 1 },
        'macbook-air': { width: 1440, height: 900, deviceScaleFactor: 1 },
      }
      const viewport = viewports[device] || viewports['iphone16']
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
    
    // Navigate to the page with retry logic
    const navigationStart = Date.now()
    let navigationSuccess = false
    let lastError = null
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 Navigation attempt ${attempt}/3 for ${url}`)
        if (attempt === 1) {
          await setPreConsentCookies(page, url)
        }
        // Try multiple wait strategies for slow/blocking sites
        let gotoSuccess = false
        const waitStrategies = ['commit', 'domcontentloaded', 'load']
        
        for (const waitUntil of waitStrategies) {
          try {
            await page.goto(url, { 
              waitUntil,
              timeout: 120000 // 2 minutes
            })
            gotoSuccess = true
            break
          } catch (gotoError) {
            // Try next strategy if this one fails
            if (waitUntil === waitStrategies[waitStrategies.length - 1]) {
              throw gotoError // Re-throw if last strategy
            }
          }
        }
        
        if (!gotoSuccess) {
          throw new Error('All navigation wait strategies failed')
        }
        
        navigationSuccess = true
        console.log(`✅ Navigation successful on attempt ${attempt}`)
        break
      } catch (error) {
        lastError = error
        console.log(`⚠️ Navigation attempt ${attempt} failed: ${error.message}`)
        if (attempt < 3) {
          await sleep(2000) // Wait before retry
        }
      }
    }
    
    if (!navigationSuccess) {
      throw new Error(`Failed to navigate to ${url} after 3 attempts. Last error: ${lastError.message}`)
    }
    
    timings.navigation = Date.now() - navigationStart
    console.log(`⏱️ Navigation completed in ${timings.navigation}ms`)

    // Brief wait for initial content
    const initialWaitStart = Date.now()
    await sleep(2000)
    timings.initialWait = Date.now() - initialWaitStart
    console.log(`⏱️ Initial wait: ${timings.initialWait}ms`)

    // Smart top ad triggering: small scrolls + refresh detection
    const topAdTriggeringStart = Date.now()
    console.log('🔄 Triggering top ad elements with smart scrolling...')
    
    // Function to check for frame changes in top area (indicating ads loading)
    const checkTopAreaChanges = async () => {
      return await page.evaluate(() => {
        // Check top 2 viewports for iframes, ads, or dynamic content
        const topArea = {
          y: 0,
          height: window.innerHeight * 2 // Top 2 viewports
        }
        
        const elements = Array.from(document.querySelectorAll('iframe, div.ad, [id*="ad"], [class*="ad"], [id*="banner"], [class*="banner"]'))
        const topElements = elements.filter(el => {
          const rect = el.getBoundingClientRect()
          return rect.top >= topArea.y && rect.top < topArea.height
        })
        
        return {
          iframeCount: topElements.filter(el => el.tagName === 'IFRAME').length,
          adElementCount: topElements.length,
          totalElements: elements.length
        }
      })
    }
    
    // Get initial state
    let previousState = await checkTopAreaChanges()
    let scrollAttempts = 0
    const maxTopScrollAttempts = 5
    
    // Small scrolls at top to trigger ads
    while (scrollAttempts < maxTopScrollAttempts) {
      // Small scroll down (100-200px)
      const scrollAmount = 100 + (scrollAttempts * 50) // Gradually increase
      await page.evaluate((amount) => {
        window.scrollBy(0, amount)
      }, scrollAmount)
      await sleep(400) // Wait for potential ad loading
      
      // Eager load after each scroll
      await eagerLoadLazyResources(page)
      await sleep(200)
      
      // Check for changes
      const currentState = await checkTopAreaChanges()
      
      // If we see new iframes or ad elements, ads might be loading
      if (currentState.iframeCount > previousState.iframeCount || 
          currentState.adElementCount > previousState.adElementCount) {
        console.log(`✅ Top ads detected (${currentState.iframeCount} iframes, ${currentState.adElementCount} ad elements)`)
        console.log('⏳ Waiting 2.5s for ads to stabilize...')
        await sleep(2500) // Wait 2.5 seconds for ads to fully load and stabilize
        break
      }
      
      // Scroll back up slightly
      await page.evaluate((amount) => {
        window.scrollBy(0, -amount * 0.5)
      }, scrollAmount)
      await sleep(300)
      
      previousState = currentState
      scrollAttempts++
      
      // Try refresh on 3rd attempt if no changes
      if (scrollAttempts === 3) {
        console.log('🔄 Trying page refresh to trigger ads...')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await sleep(1000)
        await eagerLoadLazyResources(page)
        const stateAfterRefresh = await checkTopAreaChanges()
        
        // Check if refresh triggered ads
        if (stateAfterRefresh.iframeCount > previousState.iframeCount || 
            stateAfterRefresh.adElementCount > previousState.adElementCount) {
          console.log(`✅ Top ads detected after refresh (${stateAfterRefresh.iframeCount} iframes, ${stateAfterRefresh.adElementCount} ad elements)`)
          console.log('⏳ Waiting 2.5s for ads to stabilize...')
          await sleep(2500) // Wait 2.5 seconds for ads to fully load and stabilize
          break
        }
        
        previousState = stateAfterRefresh
      }
    }
    
    // Track if ads were detected during the loop
    const adsDetected = scrollAttempts < maxTopScrollAttempts
    
    // Scroll back to top
    console.log('⬆️ Scrolling back to top...')
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    
    // If ads were detected, wait 1s then monitor for frame movement
    if (adsDetected) {
      console.log('⏳ Waiting 1s at top, then monitoring for frame movement...')
      await sleep(1000) // Initial 1s wait at top
      
      // Monitor for frame movement for up to 2s
      const monitorStart = Date.now()
      const monitorDuration = 2000 // 2 seconds
      let lastState = await checkTopAreaChanges()
      
      while (Date.now() - monitorStart < monitorDuration) {
        await sleep(300) // Check every 300ms
        const currentState = await checkTopAreaChanges()
        
        // If frames are still changing, continue monitoring
        if (currentState.iframeCount !== lastState.iframeCount || 
            currentState.adElementCount !== lastState.adElementCount) {
          console.log(`🔄 Frame movement detected (${currentState.iframeCount} iframes, ${currentState.adElementCount} ad elements), continuing to monitor...`)
          lastState = currentState
          // Reset timer - continue monitoring for full 2s from this point
          const remainingTime = monitorDuration - (Date.now() - monitorStart)
          if (remainingTime > 0) {
            await sleep(Math.min(remainingTime, 300))
          }
        }
      }
      console.log('✅ Frame monitoring complete, ads should be stable')
    } else {
      await sleep(500) // Standard settle time if no ads detected
    }
    
    timings.topAdTriggering = Date.now() - topAdTriggeringStart
    timings.frameMonitoring = timings.topAdTriggering // Frame monitoring is part of top ad triggering
    console.log(`⏱️ Top ad triggering + frame monitoring: ${timings.topAdTriggering}ms`)

        // AI-powered consent detection with Claude (priority)
        const consentFirstStart = Date.now()
        console.log('🤖 Attempting AI-powered consent detection with Claude...')
        const claudeHandledConsent = await findAndClickConsentWithClaude(page, {
          maxAttempts: 2,
          takeScreenshotAfter: true,
        })
        timings.consentFirstAttempt = Date.now() - consentFirstStart
        console.log(`⏱️ First consent attempt: ${timings.consentFirstAttempt}ms`)

        if (claudeHandledConsent) {
          console.log('✅ Claude successfully handled consent popup')
        } else {
          console.log('⚠️ Claude did not detect consent popup, continuing...')
        }

    // Eager-load lazy resources (additional pass before scrolling)
    const eagerLoadingStart = Date.now()
    console.log('🚀 Eager-loading lazy resources (pre-scroll pass)...')
    await eagerLoadLazyResources(page)
    await sleep(200) // Brief wait for browser to start fetching
    timings.eagerLoading = Date.now() - eagerLoadingStart
    console.log(`⏱️ Eager loading: ${timings.eagerLoading}ms`)
    
    // Set Step 1 completion flag
    if (job) {
      try {
        await job.updateData({ ...job.data, step1Complete: true })
        console.log('✅ Step 1 (Page Setup & Initialization) completed - flag set')
      } catch (err) {
        console.warn('⚠️ Failed to update job data for Step 1:', err.message)
      }
    }
    
    // Slow, careful auto-scroll with eager loading throughout
    const autoScrollStart = Date.now()
    
    // Adjust parameters based on device viewport size for better performance
    const isMobile = device === 'iphone16' || device === 'iphone'
    const maxAutoScrollTime = 45000
    const maxScrolls = isMobile ? 100 : 80
    const scrollDelay = isMobile ? 500 : 700 // Mobile: faster scrolling, Desktop: more thorough
    const scrollStep = isMobile ? 852 : 900 // Mobile: smaller steps for better control, Desktop: larger steps
    
    console.log(`🔄 Starting slow, careful auto-scroll with eager loading... (${isMobile ? 'mobile' : 'desktop'} mode: max ${maxScrolls} scrolls, ${maxAutoScrollTime/1000}s timeout)`)
    
    // Custom slow scroll with eager loading
    // scrollCount is declared at function scope for error reporting
    let previousHeight = 0
    let stableCount = 0
    
    console.log('📜 Phase 1: Slow scrolling to bottom with eager loading...')
    
    while (scrollCount < maxScrolls) {
      try {
        // Check if we've exceeded maximum time
        const elapsedTime = Date.now() - autoScrollStart
        if (elapsedTime > maxAutoScrollTime) {
          console.warn(`⚠️ Auto-scroll exceeded maximum time (${maxAutoScrollTime}ms), stopping early at scroll ${scrollCount}`)
        break
        }
        
        // Check for cancellation
        if (onCancellationCheck) {
          await onCancellationCheck()
        }
        
        // Get current page height with timeout protection
        let currentHeight, scrollY, viewportHeight
        try {
          const heightResult = await Promise.race([
            page.evaluate(() => {
              return {
                currentHeight: Math.max(
                  document.body.scrollHeight,
                  document.documentElement.scrollHeight,
                  document.body.offsetHeight,
                  document.documentElement.offsetHeight
                ),
                scrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
                viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0
              }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Height evaluation timeout')), 2000)) // Reduced to 2s
          ])
          currentHeight = heightResult.currentHeight
          scrollY = heightResult.scrollY
          viewportHeight = heightResult.viewportHeight
      } catch (error) {
          console.warn(`⚠️ Error getting page height at scroll ${scrollCount + 1}: ${error.message}`)
          // Use previous values as fallback
          if (previousHeight > 0) {
            currentHeight = previousHeight
            scrollY = currentHeight - 100
            viewportHeight = 900
          } else {
            break // Can't continue without height info
        }
      }
        
        // Check if height is stable
        if (currentHeight === previousHeight) {
          stableCount++
          // More aggressive "near bottom" detection for mobile (larger tolerance)
          const bottomTolerance = isMobile ? 200 : 100 // Mobile: 200px tolerance, Desktop: 100px
          const nearBottom = scrollY + viewportHeight >= currentHeight - bottomTolerance
          
          // Mobile: stop after 2 stable checks, Desktop: 3 stable checks
          const requiredStableCount = isMobile ? 2 : 3
          
          if (stableCount >= requiredStableCount && nearBottom) {
            console.log(`✅ Page height stable and at bottom, stopping scroll (stable for ${stableCount} checks, ${scrollY + viewportHeight}px / ${currentHeight}px)`)
            break
          }
          
          // Additional early stop for mobile: if height hasn't changed for 5+ checks and we're at least 80% down
          if (isMobile && stableCount >= 5) {
            const scrollProgress = (scrollY + viewportHeight) / currentHeight
            if (scrollProgress >= 0.8) {
              console.log(`✅ Mobile early stop: height stable for ${stableCount} checks, ${Math.round(scrollProgress * 100)}% down page`)
              break
            }
          }
        } else {
          stableCount = 0
          previousHeight = currentHeight
    }

        // Scroll down slowly with timeout protection and scroll lock detection
        try {
          const scrollStartTime = Date.now()
          await Promise.race([
            page.evaluate((step) => {
              const beforeScroll = window.pageYOffset || document.documentElement.scrollTop || 0
              window.scrollBy(0, step)
              // Check if scroll actually happened (scroll lock detection)
              const afterScroll = window.pageYOffset || document.documentElement.scrollTop || 0
              if (Math.abs(afterScroll - beforeScroll) < 1 && step > 0) {
                // Scroll didn't happen - might be locked, try force scroll
                window.scrollTo(0, beforeScroll + step)
              }
              return { before: beforeScroll, after: afterScroll }
            }, scrollStep),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll timeout')), 2000)) // Reduced to 2s
          ])
        } catch (error) {
          console.warn(`⚠️ Error scrolling at scroll ${scrollCount + 1}: ${error.message}`)
          // Try force scroll as fallback
          try {
            await page.evaluate((step) => {
              const current = window.pageYOffset || document.documentElement.scrollTop || 0
              window.scrollTo({ top: current + step, behavior: 'auto' })
            }, scrollStep)
            await sleep(100) // Brief pause after force scroll
          } catch (forceError) {
            console.warn(`⚠️ Force scroll also failed: ${forceError.message}`)
          }
        }
        
        // Eager load every scroll for maximum content loading
        try {
          await Promise.race([
            eagerLoadLazyResources(page),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Eager load timeout')), 2000)) // 2s timeout
          ])
        } catch (error) {
          console.warn(`⚠️ Error eager loading at scroll ${scrollCount + 1}: ${error.message}`)
          // Continue anyway - eager load is best effort
        }
        
        // Wait for content to load (slower for thoroughness)
        await sleep(scrollDelay)
        
        // Check for images loading (every 4 scrolls) with timeout protection
        if (scrollCount % 4 === 0) {
          try {
            await Promise.race([
              page.evaluate(() => {
                return Promise.all(
                  Array.from(document.images)
                    .filter(img => {
                      const rect = img.getBoundingClientRect()
                      return !img.complete && rect.width > 0 && rect.height > 0
                    })
                    .slice(0, 20) // Check more images
                    .map(img => {
                      return new Promise((resolve) => {
                        img.onload = resolve
                        img.onerror = resolve
                        setTimeout(resolve, 1500) // 1.5s timeout per image
                      })
                    })
                )
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Image check timeout')), 5000)) // Reduced to 5s
            ])
          } catch (error) {
            console.warn(`⚠️ Error checking images at scroll ${scrollCount + 1}: ${error.message}`)
            // Continue anyway - image loading is best effort
          }
        }
        
        scrollCount++
        if (scrollCount % 10 === 0 || scrollCount === 1) {
          console.log(`📊 Scroll ${scrollCount}/${maxScrolls}, height: ${currentHeight}px`)
        }
      } catch (error) {
        console.error(`❌ Critical error during scroll ${scrollCount + 1}: ${error.message}`)
        // If we've made some progress, continue; otherwise break
        if (scrollCount < 5) {
          throw error // Re-throw if we haven't made much progress
        }
        // Otherwise, log and continue (might be a transient issue)
        scrollCount++
      }
    }
    
    // Final scroll to very bottom with timeout protection and scroll lock breaking
    try {
      await Promise.race([
        page.evaluate(() => {
          const targetHeight = document.body.scrollHeight || document.documentElement.scrollHeight
          const beforeScroll = window.pageYOffset || document.documentElement.scrollTop || 0
          window.scrollTo({ top: targetHeight, behavior: 'auto' })
          // Check if scroll happened (scroll lock detection)
          const afterScroll = window.pageYOffset || document.documentElement.scrollTop || 0
          if (Math.abs(afterScroll - beforeScroll) < 10 && targetHeight > beforeScroll + 100) {
            // Scroll didn't happen - force scroll
            window.scrollTo({ top: targetHeight, behavior: 'instant' })
            // Try alternative methods
            document.documentElement.scrollTop = targetHeight
            document.body.scrollTop = targetHeight
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Final scroll timeout')), 2000)) // Reduced to 2s
      ])
      await sleep(300) // Reduced from 500ms
    } catch (error) {
      console.warn(`⚠️ Error in final scroll to bottom: ${error.message}`)
      // Try force scroll as fallback
      try {
        await page.evaluate(() => {
          const targetHeight = document.body.scrollHeight || document.documentElement.scrollHeight
          document.documentElement.scrollTop = targetHeight
          document.body.scrollTop = targetHeight
        })
      } catch (forceError) {
        console.warn(`⚠️ Force final scroll also failed: ${forceError.message}`)
      }
    }
    
    // Scroll back to top with timeout protection and scroll lock breaking
    try {
      await Promise.race([
        page.evaluate(() => {
          const beforeScroll = window.pageYOffset || document.documentElement.scrollTop || 0
          window.scrollTo({ top: 0, behavior: 'auto' })
          // Check if scroll happened (scroll lock detection)
          const afterScroll = window.pageYOffset || document.documentElement.scrollTop || 0
          if (Math.abs(afterScroll) > 10 && beforeScroll > 10) {
            // Scroll didn't happen - force scroll
            window.scrollTo({ top: 0, behavior: 'instant' })
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll to top timeout')), 2000)) // Reduced to 2s
      ])
      await sleep(300) // Reduced from 500ms
    } catch (error) {
      console.warn(`⚠️ Error scrolling to top: ${error.message}`)
      // Try force scroll as fallback
      try {
        await page.evaluate(() => {
          document.documentElement.scrollTop = 0
          document.body.scrollTop = 0
          window.scrollTo({ top: 0, behavior: 'instant' })
        })
      } catch (forceError) {
        console.warn(`⚠️ Force scroll to top also failed: ${forceError.message}`)
      }
    }
    
    console.log(`✅ Slow auto-scroll complete (${scrollCount} scrolls)`)
    timings.autoScroll = Date.now() - autoScrollStart
    console.log(`⏱️ Auto-scroll: ${timings.autoScroll}ms`)
    
    // Smart network check - monitor active requests with shorter timeout
    const networkIdleStart = Date.now()
    console.log('🌐 Checking network activity...')
    
    try {
      const maxWait = 6000 // 6 seconds max (reduced from 30s)
      const idleThreshold = 1200 // 1.2 seconds of no new requests = idle
      const checkInterval = 300 // Check every 300ms
      
      // Track requests and responses using Playwright events
      const pendingRequests = new Map()
      let lastRequestTime = Date.now()
      let stableCount = 0
      
      const requestHandler = (request) => {
        pendingRequests.set(request.url(), Date.now())
        lastRequestTime = Date.now()
        stableCount = 0
      }
      
      const responseHandler = (response) => {
        pendingRequests.delete(response.url())
      }
      
      page.on('request', requestHandler)
      page.on('response', responseHandler)
      
      const networkStart = Date.now()
    
      // Poll until network is idle or max wait reached
      while (Date.now() - networkStart < maxWait) {
        await sleep(checkInterval)
        
        const activeCount = pendingRequests.size
        const timeSinceLastRequest = Date.now() - lastRequestTime
        
        if (activeCount === 0 && timeSinceLastRequest >= idleThreshold) {
          stableCount++
          if (stableCount >= 2) { // Confirmed idle for 2 checks
            break
          }
        } else {
          stableCount = 0
        }
      }
      
      // Clean up event listeners
      page.off('request', requestHandler)
      page.off('response', responseHandler)
      
      const networkTime = Date.now() - networkStart
      if (networkTime >= maxWait) {
        console.log(`⚠️ Network check timeout (${maxWait}ms), continuing...`)
      } else {
        console.log(`✅ Network settled (${networkTime}ms)`)
      }
      timings.networkIdle = Date.now() - networkIdleStart
      console.log(`⏱️ Network idle check: ${timings.networkIdle}ms`)
    } catch (e) {
      console.log('⚠️ Network check failed, continuing...')
      timings.networkIdle = Date.now() - networkIdleStart
    }
    
    // Optimized content readiness check - faster but still reliable with AGGRESSIVE timeout
    const contentReadinessStart = Date.now()
    console.log('🖼️ Final content readiness check...')
    const maxContentReadinessTime = 10000 // 10 seconds max (prevents 385s hangs)
    
    try {
      await Promise.race([
        page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      
          // Wait for visible images only (faster) - LIMIT to first 30 to prevent hanging
      const images = Array.from(document.querySelectorAll('img'))
        .filter(img => {
          const rect = img.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 // Only visible images
        })
            .slice(0, 30) // Limit to prevent excessive waiting
      
      const imagePromises = images.map(img => {
        if (img.complete && img.naturalHeight > 0) return Promise.resolve()
        return new Promise((resolve) => {
              const timeout = setTimeout(resolve, 1000) // Reduced: 1000ms per image
          img.onload = () => { clearTimeout(timeout); resolve() }
          img.onerror = () => { clearTimeout(timeout); resolve() }
        })
      })
      await Promise.all(imagePromises)
      
          // Wait for visible iframes only - LIMIT to first 15
      const iframes = Array.from(document.querySelectorAll('iframe'))
        .filter(iframe => {
          const rect = iframe.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 // Only visible iframes
        })
            .slice(0, 15) // Limit to prevent excessive waiting
      
      const iframePromises = iframes.map(iframe => {
        return new Promise((resolve) => {
              const timeout = setTimeout(resolve, 2000) // Reduced: 2000ms per iframe
          if (iframe.contentDocument?.readyState === 'complete') {
            clearTimeout(timeout)
            resolve()
          } else {
            iframe.onload = () => { clearTimeout(timeout); resolve() }
            iframe.onerror = () => { clearTimeout(timeout); resolve() }
          }
        })
      })
      await Promise.all(iframePromises)
      
          // Brief wait for any remaining content
          await sleep(500) // Reduced: 500ms
        }),
        new Promise((resolve) => {
          setTimeout(() => {
            console.log(`⚠️ Content readiness check timeout (${maxContentReadinessTime}ms), continuing...`)
            resolve()
          }, maxContentReadinessTime)
        })
      ])
    } catch (err) {
      console.warn(`⚠️ Content readiness check error: ${err.message}, continuing...`)
    }
    
    timings.contentReadiness = Date.now() - contentReadinessStart
    console.log(`⏱️ Content readiness check: ${timings.contentReadiness}ms`)
    
    // Set Step 2 completion flag
    if (job) {
      try {
        await job.updateData({ ...job.data, step2Complete: true })
        console.log('✅ Step 2 (Content Loading & Stabilization) completed - flag set')
      } catch (err) {
        console.warn('⚠️ Failed to update job data for Step 2:', err.message)
      }
    }
    
    // Scroll back to top for final screenshot with timeout and scroll lock breaking
    console.log('⬆️ Scrolling to top for final screenshot...')
    try {
      await Promise.race([
        page.evaluate(() => {
          const beforeScroll = window.pageYOffset || document.documentElement.scrollTop || 0
      window.scrollTo({ top: 0, behavior: 'instant' })
          // Check if scroll happened (scroll lock detection)
          const afterScroll = window.pageYOffset || document.documentElement.scrollTop || 0
          if (Math.abs(afterScroll) > 10 && beforeScroll > 10) {
            // Scroll didn't happen - force scroll
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
            window.scrollTo({ top: 0, behavior: 'instant' })
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll to top timeout')), 2000))
      ])
      await sleep(200) // Reduced from 300ms
    } catch (error) {
      console.warn(`⚠️ Error scrolling to top for screenshot: ${error.message}`)
      // Try force scroll as fallback
      try {
        await page.evaluate(() => {
          document.documentElement.scrollTop = 0
          document.body.scrollTop = 0
        })
      } catch (forceError) {
        console.warn(`⚠️ Force scroll to top also failed: ${forceError.message}`)
      }
    }
    
    console.log('✅ Content loaded and stabilized, proceeding to targeted ad lookup')
    
    // Check for cancellation before consent handling
    if (onCancellationCheck) {
      await onCancellationCheck()
    }
    
    // AI-powered consent detection after content loading (second attempt) - with timeout protection
    const consentSecondStart = Date.now()
    console.log('🤖 Scanning for cookie banners after content load with Claude...')
    
    // Add overall timeout to prevent hanging (max 15 seconds for second attempt)
    const consentSecondAttemptPromise = findAndClickConsentWithClaude(page, {
      maxAttempts: 1,
      takeScreenshotAfter: false,
    })
    
    const consentSecondTimeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn('⚠️ Second consent attempt timeout (15s), continuing...')
        resolve(false)
      }, 15000) // 15 second timeout
    })
    
    const claudeHandledConsentAfterLoad = await Promise.race([
      consentSecondAttemptPromise,
      consentSecondTimeoutPromise
    ])
    
    timings.consentSecondAttempt = Date.now() - consentSecondStart
    console.log(`⏱️ Second consent attempt: ${timings.consentSecondAttempt}ms`)
    
    if (claudeHandledConsentAfterLoad) {
      console.log('✅ Claude handled consent popup after content load')
    } else {
      console.log('⚠️ No consent popup detected after content load')
    }
    
    // Check for cancellation before popup closing
    if (onCancellationCheck) {
      await onCancellationCheck()
    }
    
    // Check for and close any remaining popups (surveys, newsletters, etc.)
    // Optimized: reduced attempts and levels for faster processing
    const popupClosingStart = Date.now()
    console.log('🔍 Scanning for popup close buttons before ad detection...')
    try {
      await Promise.race([
        findAndClosePopupsWithClaude(page, {
          maxAttempts: 1, // Reduced from 2 to 1 for faster processing
          maxLevels: 2, // Reduced from 3 to 2 for faster processing
        }),
        new Promise((resolve) => {
          setTimeout(() => {
            console.log('⚠️ Popup closing timeout (8s), continuing...')
            resolve()
          }, 8000) // 8 second timeout for popup closing
        })
      ])
    } catch (err) {
      console.warn(`⚠️ Popup closing error: ${err.message}, continuing...`)
    }
    timings.popupClosing = Date.now() - popupClosingStart
    console.log(`⏱️ Popup closing: ${timings.popupClosing}ms`)
    
    // Check for cancellation before ad detection
    if (onCancellationCheck) {
      await onCancellationCheck()
    }
    
    // Detect various ad elements (AFTER closing popups to avoid detecting ads in popups)
    const adDetectionSelectorStart = Date.now()
    console.log('📊 Detecting ad elements on clean page...')
    const adSlots = await page.evaluate(() => {
      const isSizeMatch = (rect, width, height, tolerance = 5) => {
        return Math.abs(rect.width - width) <= tolerance && Math.abs(rect.height - height) <= tolerance
      }

      const shouldSkipAsStandardMpu = (rect) => isSizeMatch(rect, 300, 250)
      // Helper to find the actual ad container (not a child element)
      const findAdContainer = (el) => {
        // Check if element itself looks like a container
        const rect = el.getBoundingClientRect()
        const id = (el.id || '').toLowerCase()
        const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '')).toLowerCase()
        
        // If element has ad-related identifiers and reasonable size, it's likely the container
        const hasAdIdentifier = id.includes('ad') || id.includes('banner') || id.includes('werbung') || id.includes('anzeige') ||
                                className.includes('ad') || className.includes('banner') || className.includes('werbung') || className.includes('anzeige')
        
        if (hasAdIdentifier && rect.width >= 100 && rect.height >= 50) {
          return el
        }
        
        // Look for parent container (up to 3 levels)
        let parent = el.parentElement
        let levels = 0
        while (parent && levels < 3) {
          const parentRect = parent.getBoundingClientRect()
          const parentId = (parent.id || '').toLowerCase()
          const parentClassName = (typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '')).toLowerCase()
          
          const parentHasAdIdentifier = parentId.includes('ad') || parentId.includes('banner') || parentId.includes('werbung') || parentId.includes('anzeige') ||
                                        parentClassName.includes('ad') || parentClassName.includes('banner') || parentClassName.includes('werbung') || parentClassName.includes('anzeige')
          
          // If parent is significantly larger and has ad identifiers, use it
          if (parentHasAdIdentifier && parentRect.width >= rect.width * 1.2 && parentRect.height >= rect.height * 1.2) {
            return parent
          }
          
          // If parent is much larger (likely the container), use it
          if (parentRect.width >= 200 && parentRect.height >= 100 && parentRect.width > rect.width * 1.5) {
            return parent
          }
          
          parent = parent.parentElement
          levels++
        }
        
        return el // Return original if no better container found
      }
      
      const toAbs = (el) => {
        const container = findAdContainer(el)
        const r = container.getBoundingClientRect()
        
        // Validate rect is valid and visible
        if (r.width <= 0 || r.height <= 0 || r.top < -10000 || r.left < -10000) {
          return { x: 0, y: 0 }
        }
        
        const sx = window.pageXOffset || document.documentElement.scrollLeft || 0
        const sy = window.pageYOffset || document.documentElement.scrollTop || 0
        return { x: Math.round(r.left + sx), y: Math.round(r.top + sy) }
      }
      
      const getSize = (el) => {
        const container = findAdContainer(el)
        const r = container.getBoundingClientRect()
        
        // Validate rect is valid
        if (r.width <= 0 || r.height <= 0) {
          return { width: 0, height: 0 }
        }
        
        return { width: Math.round(r.width), height: Math.round(r.height) }
      }
      
      // Validate ad element is complete and not partial
      const isValidAdElement = (el) => {
        const rect = el.getBoundingClientRect()
        
        // Must have valid dimensions
        if (rect.width <= 0 || rect.height <= 0) return false
        
        // Check if element is actually visible (not hidden)
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false
        }
        
        // Check if element is in viewport or reasonable scroll position
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth
        const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        
        // Element should be within reasonable bounds (not way off screen)
        const maxReasonableY = scrollHeight + viewportHeight
        const maxReasonableX = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) + viewportWidth
        
        const absTop = rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0)
        const absLeft = rect.left + (window.pageXOffset || document.documentElement.scrollLeft || 0)
        
        if (absTop < -viewportHeight || absTop > maxReasonableY) return false
        if (absLeft < -viewportWidth || absLeft > maxReasonableX) return false
        
        return true
      }
      
      const adElements = []
      let adCounter = 1
      
      // 1. Google ad iframes - HIGHEST PRIORITY
      const googleFrames = Array.from(document.querySelectorAll('div[id^="google_ads_iframe_"], iframe[id^="google_ads_iframe_"]'))
      googleFrames.forEach((div, i) => {
        if (!isValidAdElement(div)) return
        
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const position = toAbs(div)
          const size = getSize(div)
          
          // Validate position and size are valid
          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id: div.id || `google-ad-${adCounter++}`,
            selector: div.id ? `#${div.id}` : `div[id^="google_ads_iframe_"]:nth-of-type(${i + 1})`,
              position,
              size,
            element: { tagName: div.tagName, id: div.id, className: div.className || '', src: div.getAttribute('data-src') || div.getAttribute('src') || null },
            type: 'iframe-google-ads',
            priority: 1 // Highest priority
          })
        }
        }
      })
      
      // Helper to add ad element with validation
      const addAdElement = (el, type, defaultId, selectorFn) => {
        if (!isValidAdElement(el)) return
        
        const r = el.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const position = toAbs(el)
          const size = getSize(el)
          
          // Validate position and size are valid and reasonable
          if (position.x >= 0 && position.y >= 0 && 
              size.width > 0 && size.height > 0 &&
              size.width < 10000 && size.height < 10000) { // Sanity check
          adElements.push({
              id: el.id || defaultId,
              selector: selectorFn ? selectorFn(el, adCounter++) : (el.id ? `#${el.id}` : null),
              position,
              size,
              element: { 
                tagName: el.tagName, 
                id: el.id, 
                className: typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || ''),
                src: el.getAttribute('src') || el.getAttribute('data-src') || null 
              },
              type
            })
          }
        }
      }
      
      // 2. FlashTalking ads
      const flashTalkingAds = Array.from(document.querySelectorAll('ins.ftads.flashtalking_ads'))
      flashTalkingAds.forEach((ad, i) => {
        addAdElement(ad, 'flashtalking-ads', `flashtalking-ad-${adCounter++}`, 
          (el, counter) => el.id ? `#${el.id}` : `ins.ftads.flashtalking_ads:nth-of-type(${i+1})`)
      })
      
      // 3. Google AdSense ads
      const adsenseAds = Array.from(document.querySelectorAll('ins.adsbygoogle'))
      adsenseAds.forEach((ad, i) => {
        addAdElement(ad, 'adsense-ads', `adsense-ad-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `ins.adsbygoogle:nth-of-type(${i+1})`)
      })
      
      // 4. Inside post ads
      const insidePostAds = Array.from(document.querySelectorAll('div.inside-post-ad-1.inside-post-ad.ads_common_inside_post'))
      insidePostAds.forEach((ad, i) => {
        addAdElement(ad, 'inside-post-ads', `inside-post-ad-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `div.inside-post-ad-1.inside-post-ad.ads_common_inside_post:nth-of-type(${i+1})`)
      })
      
      // 5. Sky ad iframes (skyLeft__ and skyRight__)
      const skyFrames = Array.from(document.querySelectorAll('iframe[id^="skyLeft__"], iframe[id^="skyRight__"]'))
      skyFrames.forEach((frame, i) => {
        if (!isValidAdElement(frame)) return
        
        const r = frame.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const isLeft = frame.id.startsWith('skyLeft__')
          const position = toAbs(frame)
          const size = getSize(frame)
          
          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id: frame.id || `sky-ad-${adCounter++}`,
            selector: frame.id ? `#${frame.id}` : `iframe[id^="${isLeft ? 'skyLeft__' : 'skyRight__'}"]:nth-of-type(${i+1})`,
              position,
              size,
            element: { tagName: frame.tagName, id: frame.id, className: frame.className || '', src: frame.src || null },
            type: isLeft ? 'iframe-sky-left' : 'iframe-sky-right'
          })
          }
        }
      })
      
      // 6. Detect MREC BTF iBanner ads: mrec_btf_ibanner, mrec_btf_3_ibanner, mrec_btf_4_ibanner
      const mrecIbannerDivs = Array.from(
        document.querySelectorAll('div[id*="mrec_btf"][id$="ibanner"]')
      );

      mrecIbannerDivs.forEach((div, i) => {
        if (!isValidAdElement(div)) return

        const id = div.id || `mrec-btf-ibanner-${adCounter++}`;
        const valid = /^mrec_btf(?:_\d+)?_ibanner$/i.test(id);
        if (!valid) return;

        const r = div.getBoundingClientRect();
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const position = toAbs(div)
          const size = getSize(div)
          
          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id,
            selector: `#${id}`,
              position,
              size,
            element: {
              tagName: div.tagName,
              id,
                className: typeof div.className === 'string' ? div.className : (div.className?.baseVal || div.className?.toString() || '')
            },
            type: 'div-mrec-btf-ibanner'
          });
          }
        }
      });
      
      // 7. Divs with "ibanner" in the id
      const ibannerDivs = Array.from(document.querySelectorAll('div[id*="ibanner"]'))
      ibannerDivs.forEach((div, i) => {
        addAdElement(div, 'div-ibanner', `ibanner-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `div[id*="ibanner"]:nth-of-type(${i + 1})`)
      })
      
      // 8. Value ads (divs with iqdValueAdLeft / iqdValueAdRight in id)
      const iqdValueAdDivs = Array.from(
        document.querySelectorAll('div[id*="iqdValueAd"]')
      );

      iqdValueAdDivs.forEach((div, i) => {
        if (!isValidAdElement(div)) return
        
        const r = div.getBoundingClientRect();
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const id = div.id || `iqd-value-ad-${adCounter++}`;
          const position = toAbs(div)
          const size = getSize(div)

          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id,
            selector: `#${id}`,
              position,
              size,
            element: {
              tagName: div.tagName,
              id,
                className: typeof div.className === 'string' ? div.className : (div.className?.baseVal || div.className?.toString() || '')
            },
            type: 'div-iqd-valueAd'
          });
        }
        }
      });

      // 8b. Sidebar wrapper ads (all variations: iqdSitebarL, iqdSitebar, iqdSitebarWrapperL, iqdSitebarWrapper)
      const sidebarWrapperDivs = Array.from(
        document.querySelectorAll('div[id="iqdSitebarL"], div[id="iqdSitebar"], div[id="iqdSitebarWrapperL"], div[id="iqdSitebarWrapper"]')
      );
      
      sidebarWrapperDivs.forEach((div, i) => {
        addAdElement(div, 'div-sidebar-wrapper', `sidebar-wrapper-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `div[id="${el.id}"]`)
      });

      // 8c. Divs with IDs containing ad position keywords
      const adPositionDivs = Array.from(
        document.querySelectorAll('div[id*="adBanner"], div[id*="adBanner_"], div[id*="topAd"], div[id*="rightAd"], div[id*="leftAd"], div[id="iqdSkyContainer"]')
      );
      
      adPositionDivs.forEach((div, i) => {
        addAdElement(div, 'div-ad-position', `ad-position-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `div[id*="adBanner"], div[id*="adBanner_"], div[id*="topAd"], div[id*="rightAd"], div[id*="leftAd"], div[id="iqdSkyContainer"]:nth-of-type(${i + 1})`)
      });

      // 9. ContainerSize_728X90
      const ContainerSize728X90Divs = Array.from(document.querySelectorAll('div[id*="container-728x90"]'))
      ContainerSize728X90Divs.forEach((div, i) => {
        addAdElement(div, 'div-container-728x90', `container-728x90-${adCounter++}`,
          (el, counter) => el.id ? `#${el.id}` : `div[id*="container-728x90"]:nth-of-type(${i + 1})`)
      })

      // 10. Superbanners & banner containers
      const bannerCandidates = Array.from(
        document.querySelectorAll('div[id*="superbanner"], div[id*="banner_bannerCont"]')
      );

      const superbannerRegex = /(^superbanner_[^_\s]+_(?:leftBar|rightBar)$)/i;
      const superbannerBannerContRegex = /superbanner_bannerCont/i;
      const bannerBannerContRegex = /banner_bannerCont/i;

      bannerCandidates.forEach((div, i) => {
        if (!isValidAdElement(div)) return
        
        const id = div.id || '';
        const isSuperLeftRight = superbannerRegex.test(id);
        const isSuperBannerCont = superbannerBannerContRegex.test(id);
        const isBannerBannerCont = bannerBannerContRegex.test(id);

        if (!isSuperLeftRight && !isSuperBannerCont && !isBannerBannerCont) return;

        const r = div.getBoundingClientRect();
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const genId = id || `bar-banner-${adCounter++}`;
          let type = 'div-generic-bar-banner';
          if (isSuperLeftRight) {
            type = id.toLowerCase().includes('leftbar') ? 'div-superbanner-leftbar' : 'div-superbanner-rightbar';
          } else if (isSuperBannerCont) {
            type = 'div-superbanner-bannercont';
          } else if (isBannerBannerCont) {
            type = 'div-banner-bannercont';
          }

          const position = toAbs(div)
          const size = getSize(div)
          
          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id: genId,
            selector: `#${genId}`,
              position,
              size,
              element: { 
                tagName: div.tagName, 
                id: genId, 
                className: typeof div.className === 'string' ? div.className : (div.className?.baseVal || div.className?.toString() || '')
              },
            type
          });
          }
        }
      });

      // 11. Sky slots (sky_... and sky_rlSlot_... with leftBar/rightBar)
      const skyCandidates = Array.from(document.querySelectorAll('div[id*="sky_"], div[id*="rlSlot"]'));

      const skyRegex = /^(?:sky_[^_\s]+_(?:leftBar|rightBar)|sky_rlSlot_[^_\s]+_(?:leftBar|rightBar))$/i;

      skyCandidates.forEach((div, i) => {
        if (!isValidAdElement(div)) return
        
        const id = div.id || '';
        if (!skyRegex.test(id)) return;

        const r = div.getBoundingClientRect();
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          const genId = id || `sky-slot-${adCounter++}`;
          const isLeft = genId.toLowerCase().includes('leftbar');
          const position = toAbs(div)
          const size = getSize(div)

          if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id: genId,
            selector: `#${genId}`,
              position,
              size,
              element: { 
                tagName: div.tagName, 
                id: genId, 
                className: typeof div.className === 'string' ? div.className : (div.className?.baseVal || div.className?.toString() || '')
              },
            type: isLeft ? 'div-sky-leftbar' : 'div-sky-rightbar'
          });
          }
        }
      });
      
      // 12. Generic ad-sized iframes
      const adSizeProfiles = [
        { width: 300, height: 250, type: 'iframe-300x250' }
      ]
      const adSizedIframes = Array.from(document.querySelectorAll('iframe'))
      
      adSizedIframes.forEach((frame, i) => {
        if (!isValidAdElement(frame)) return
        
        const r = frame.getBoundingClientRect()
        if (r.width < 20 || r.height < 20) return
        
        for (const profile of adSizeProfiles) {
          const widthDelta = Math.abs(r.width - profile.width)
          const heightDelta = Math.abs(r.height - profile.height)
          const tolerance = 5
          
          if (widthDelta <= tolerance && heightDelta <= tolerance) {
            const position = toAbs(frame)
            const size = getSize(frame)
            
            // Only add if size is valid (not 0x0) and position is valid
            if (size.width > 0 && size.height > 0 && position.x >= 0 && position.y >= 0) {
              adElements.push({
                id: frame.id || `${profile.type}-${adCounter++}`,
                selector: frame.id ? `#${frame.id}` : `iframe:nth-of-type(${i + 1})`,
                position,
                size,
                element: { 
                  tagName: frame.tagName, 
                  id: frame.id, 
                  className: typeof frame.className === 'string' ? frame.className : (frame.className?.baseVal || frame.className?.toString() || ''), 
                  src: frame.src || null 
                },
                type: profile.type
              })
            }
            break
          }
        }
      })
      
      // 13. Clickable elements with target="_blank" (2nd priority - ads open in new tabs)
      // Check both direct elements and their parent containers
      const clickableTargetBlankElements = Array.from(document.querySelectorAll('a[target="_blank"], area[target="_blank"], button[target="_blank"]'))
      clickableTargetBlankElements.forEach((el, i) => {
        // Find the container frame (could be the element itself or its parent)
        let container = el
        let hasTargetBlank = el.getAttribute('target') === '_blank'
        
        // Check if parent has target="_blank" (for nested structures)
        let parent = el.parentElement
        let levels = 0
        while (parent && levels < 3 && !hasTargetBlank) {
          if (parent.getAttribute('target') === '_blank') {
            hasTargetBlank = true
            container = parent
            break
          }
          parent = parent.parentElement
          levels++
        }
        
        // Use container for size/position checks
        if (!isValidAdElement(container)) return
        
        const r = container.getBoundingClientRect()
        const width = r.width
        const height = r.height
        
        // Size requirements:
        // - If one dimension is above 250px, the other minimum is 50px
        // - Otherwise, both minimum are 200px
        const meetsSizeRequirement = (width > 250 && height >= 50) || 
                                     (height > 250 && width >= 50) ||
                                     (width >= 200 && height >= 200)
        
        if (!meetsSizeRequirement) return
        
        const position = toAbs(container)
        const size = getSize(container)
        
        if (position.x >= 0 && position.y >= 0 && size.width > 0 && size.height > 0) {
          adElements.push({
            id: container.id || el.id || `target-blank-ad-${adCounter++}`,
            selector: container.id ? `#${container.id}` : (el.id ? `#${el.id}` : `a[target="_blank"]:nth-of-type(${i + 1})`),
            position,
            size,
            element: {
              tagName: container.tagName,
              id: container.id || el.id,
              className: typeof container.className === 'string' ? container.className : (container.className?.baseVal || container.className?.toString() || ''),
              src: el.href || el.getAttribute('href') || container.getAttribute('href') || null
            },
            type: 'clickable-target-blank',
            priority: 2 // Second priority after google_ads_iframe
          })
        }
      })
      
      // Validate and normalize ad elements structure
      return adElements
        .map(slot => {
          // Ensure position has only x, y
          const position = slot.position && typeof slot.position === 'object' 
            ? { x: slot.position.x || 0, y: slot.position.y || 0 }
            : { x: 0, y: 0 }
          
          // Ensure size has width, height
          const size = slot.size && typeof slot.size === 'object'
            ? { width: slot.size.width || 0, height: slot.size.height || 0 }
            : { width: 0, height: 0 }
          
          return {
            ...slot,
            position,
            size,
            source: 'selector', // Mark as selector pattern detection
            priority: slot.priority || 3 // Default priority is 3 (lowest), preserve existing priority if set
          }
        })
        .filter(slot => {
          // Filter out slots with invalid size (0x0 or negative)
          return slot.size.width > 0 && slot.size.height > 0
        })
    })
    
    console.log(`✅ Selector patterns found ${adSlots.length} ads`)
    
    // Detect ads using Claude AI
    console.log('🤖 Running Claude AI ad detection...')
    const claudeAds = await detectAdsWithClaude(page, { maxAttempts: 1 })
    
    // Convert Claude ads to same format with validation
    const claudeAdsFormatted = claudeAds
      .filter(ad => {
        // Validate Claude ad coordinates are reasonable
        if (ad.x < 0 || ad.y < 0) return false
        if (ad.width <= 0 || ad.height <= 0) return false
        if (ad.width > 2000 || ad.height > 2000) return false // Maximum size limit: 2000px
        
        // Minimum size filters ONLY for Claude-detected ads
        const width = ad.width
        const height = ad.height
        
        // Drop if both height and width are below 200px
        if (width < 200 && height < 200) {
          return false
        }
        
        // Drop if either height or width is below 100px
        if (width < 100 || height < 100) {
          return false
        }
        
        // Get page dimensions to validate - strict bounds checking
        return page.evaluate((adData) => {
          const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
          const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
          
          // Strict validation: ad must be within document bounds (small 50px margin for rounding)
          const adTop = adData.y
          const adBottom = adData.y + adData.height
          const adLeft = adData.x
          const adRight = adData.x + adData.width
          
          // Ad must be within document bounds (top edge, bottom edge, left edge, right edge)
          return adTop >= -50 && // Allow small negative for elements slightly above viewport
                 adBottom <= scrollHeight + 50 && // Bottom edge must be within content
                 adLeft >= -50 && // Allow small negative for elements slightly left of viewport
                 adRight <= scrollWidth + 50 // Right edge must be within content
        }, ad).catch(() => false) // If check fails, exclude the ad (safer)
      })
      .map(ad => ({
        id: `claude-ad-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        selector: null, // Claude doesn't provide selectors
        position: { x: Math.round(ad.x), y: Math.round(ad.y) },
        size: { width: Math.round(ad.width), height: Math.round(ad.height) },
        element: {
          tagName: 'div',
          id: null,
          className: null,
          src: null
        },
        type: 'claude-detected',
        source: 'claude-ai',
        confidence: ad.confidence || 'high',
        priority: 3 // Default priority (lowest)
      }))
    
    console.log(`✅ Claude AI found ${claudeAdsFormatted.length} ads`)
    
    // Combine both detection methods
    let allAds = [...adSlots, ...claudeAdsFormatted]
    console.log(`📊 Total ads before filtering: ${allAds.length} (${adSlots.length} selectors + ${claudeAdsFormatted.length} Claude)`)
    
    // Filter and deduplicate ads
    console.log('🔍 Filtering and deduplicating ads...')
    
    // Step 1: Apply maximum size limit to ALL ads (hardcoded and Claude)
    const beforeMaxSizeFilter = allAds.length
    allAds = allAds.filter(ad => {
      const width = ad.size.width
      const height = ad.size.height
      
      // Maximum size limit: 2000px for both width and height (prevents invalid detections)
      if (width > 2000 || height > 2000) {
        return false
      }
      
      return true
    })
    
    const maxSizeFiltered = beforeMaxSizeFilter - allAds.length
    if (maxSizeFiltered > 0) {
      console.log(`📏 Filtered out ${maxSizeFiltered} ads (exceeds 2000px limit)`)
    }
    
    // Note: Minimum size filters are applied ONLY to Claude-detected ads (done above)
    // Hardcoded patterns have no minimum size restrictions
    
    // Step 2: Handle overlapping ads
    const beforeOverlapFilter = allAds.length
    const filteredAds = []
    const processedIndices = new Set()
    
    for (let i = 0; i < allAds.length; i++) {
      if (processedIndices.has(i)) continue
      
      const ad1 = allAds[i]
      const ad1Left = ad1.position.x
      const ad1Right = ad1.position.x + ad1.size.width
      const ad1Top = ad1.position.y
      const ad1Bottom = ad1.position.y + ad1.size.height
      const ad1Area = ad1.size.width * ad1.size.height
      
      let shouldKeepAd1 = true
      
      // Check against all other ads
      for (let j = i + 1; j < allAds.length; j++) {
        if (processedIndices.has(j)) continue
        
        const ad2 = allAds[j]
        const ad2Left = ad2.position.x
        const ad2Right = ad2.position.x + ad2.size.width
        const ad2Top = ad2.position.y
        const ad2Bottom = ad2.position.y + ad2.size.height
        const ad2Area = ad2.size.width * ad2.size.height
        
        // Check if ads overlap
        const overlapX = ad1Left < ad2Right && ad1Right > ad2Left
        const overlapY = ad1Top < ad2Bottom && ad1Bottom > ad2Top
        const overlaps = overlapX && overlapY
        
        if (!overlaps) continue
        
        // Calculate overlap area
        const overlapLeft = Math.max(ad1Left, ad2Left)
        const overlapRight = Math.min(ad1Right, ad2Right)
        const overlapTop = Math.max(ad1Top, ad2Top)
        const overlapBottom = Math.min(ad1Bottom, ad2Bottom)
        const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
        
        // Priority-based overlap resolution (lower number = higher priority)
        const ad1Priority = ad1.priority || 3 // Default priority is 3
        const ad2Priority = ad2.priority || 3
        
        // Check if one is completely inside the other (super/sub frame)
        const ad1InsideAd2 = ad1Left >= ad2Left && ad1Right <= ad2Right && ad1Top >= ad2Top && ad1Bottom <= ad2Bottom
        const ad2InsideAd1 = ad2Left >= ad1Left && ad2Right <= ad1Right && ad2Top >= ad1Top && ad2Bottom <= ad1Bottom
        
        if (ad1InsideAd2) {
          // ad1 is sub-frame of ad2
          // Check priority: if ad1 has higher priority, keep ad1 and drop ad2
          if (ad1Priority < ad2Priority) {
            // ad1 has higher priority, drop ad2 (the container)
            processedIndices.add(j)
            continue
          } else {
            // ad2 has same or higher priority, drop ad1 (the sub-frame)
            shouldKeepAd1 = false
            processedIndices.add(i)
            break
          }
        } else if (ad2InsideAd1) {
          // ad2 is sub-frame of ad1
          // Check priority: if ad2 has higher priority, keep ad2 and drop ad1
          if (ad2Priority < ad1Priority) {
            // ad2 has higher priority, drop ad1 (the container)
            shouldKeepAd1 = false
            processedIndices.add(i)
            break
          } else {
            // ad1 has same or higher priority, drop ad2 (the sub-frame)
            processedIndices.add(j)
            continue
          }
        } else if (overlaps) {
          // ANY overlap (even 1%) is not tolerable - one must be removed
          // Priority already calculated above
          
          if (ad1Priority < ad2Priority) {
            // ad1 has higher priority, keep ad1, drop ad2
            processedIndices.add(j)
            continue
          } else if (ad2Priority < ad1Priority) {
            // ad2 has higher priority, drop ad1, keep ad2
            shouldKeepAd1 = false
            processedIndices.add(i)
            break
          } else {
            // Same priority: use source-based logic
            // Different sources: prefer selector over claude
            if (ad1.source === 'selector' && ad2.source === 'claude-ai') {
              // Keep ad1 (selector), drop ad2 (claude)
              processedIndices.add(j)
              continue
            } else if (ad1.source === 'claude-ai' && ad2.source === 'selector') {
              // Drop ad1 (claude), keep ad2 (selector)
              shouldKeepAd1 = false
              processedIndices.add(i)
              break
            } else {
              // Same source and priority: drop the one with smaller area (or either if same area)
              if (ad1Area < ad2Area) {
                shouldKeepAd1 = false
                processedIndices.add(i)
                break
              } else if (ad2Area < ad1Area) {
                processedIndices.add(j)
                continue
              } else {
                // Same area: drop ad1 (keep first one encountered)
                shouldKeepAd1 = false
                processedIndices.add(i)
                break
              }
            }
          }
        }
      }
      
      if (shouldKeepAd1) {
        filteredAds.push(ad1)
      }
    }
    
    allAds = filteredAds
    const overlapFiltered = beforeOverlapFilter - allAds.length
    if (overlapFiltered > 0) {
      console.log(`🔄 Filtered out ${overlapFiltered} ads (overlapping/duplicates)`)
    }
    
    // Final validation: ensure all ads have valid positions and sizes within document bounds
    const beforeValidation = allAds.length
    
    // Get document dimensions once for all ads
    const documentBounds = await page.evaluate(() => {
      return {
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
      }
    })
    
    const finalAdSlots = allAds.filter(ad => {
      if (!ad.position || !ad.size) {
        console.warn(`⚠️ Dropping ad with missing position/size:`, ad.id)
        return false
      }
      
      const { x, y } = ad.position
      const { width, height } = ad.size
      
      // Validate coordinates are reasonable
      if (x < 0 || y < 0 || width <= 0 || height <= 0) {
        console.warn(`⚠️ Dropping ad with invalid coordinates:`, ad.id, { x, y, width, height })
        return false
      }
      
      // Maximum size limit: 2000px for both width and height
      if (width > 2000 || height > 2000) {
        console.warn(`⚠️ Dropping ad exceeding 2000px limit:`, ad.id, { width, height })
        return false
      }
      
      // Strict bounds checking: ad must be within document content (small 50px margin for rounding)
      const adBottom = y + height
      const adRight = x + width
      if (y < -50 || // Top edge too far above
          adBottom > documentBounds.scrollHeight + 50 || // Bottom edge beyond content
          x < -50 || // Left edge too far left
          adRight > documentBounds.scrollWidth + 50) { // Right edge beyond content
        console.warn(`⚠️ Dropping ad outside document bounds:`, ad.id, { 
          x, y, width, height, 
          adBottom, adRight,
          scrollHeight: documentBounds.scrollHeight,
          scrollWidth: documentBounds.scrollWidth
        })
        return false
      }
      
      return true
    })
    
    const validationFiltered = beforeValidation - finalAdSlots.length
    if (validationFiltered > 0) {
      console.log(`🔍 Filtered out ${validationFiltered} ads during final validation`)
    }
    
    console.log(`✅ Final ads after all filtering: ${finalAdSlots.length}`)
    if (maxSizeFiltered > 0 || overlapFiltered > 0 || validationFiltered > 0) {
      console.log(`📊 Filtering summary: ${maxSizeFiltered} exceeds 2000px limit, ${overlapFiltered} overlapping/duplicates, ${validationFiltered} invalid coordinates`)
    }

    // Ensure we're at the top for full-page screenshot
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
    await sleep(300) // Reduced from 500ms
    
    // Generate full-page screenshot with optimized settings
    const screenshotStart = Date.now()
    console.log('📸 Capturing full-page screenshot...')
    
    // Disable animations and transitions for cleaner, faster screenshot
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `
    })
    await sleep(200) // Brief wait for styles to apply (reduced from 300ms)
    
    // Use JPEG for heavy desktop pages to reduce size and speed up encoding
    // Keep PNG for mobile where files are smaller anyway
    const screenshotOptions = {
      fullPage: true,
      timeout: 180000, // 3 minutes timeout
      animations: 'disabled', // Playwright built-in animation disabling
    }

    if (device === 'macbook-air') {
      // Heavier page: use JPEG with quality to speed up encoding and reduce size
      screenshotOptions.type = 'jpeg'
      screenshotOptions.quality = 80
    } else {
      // Mobile: PNG is fine
      screenshotOptions.type = 'png'
    }

    const screenshot = await page.screenshot(screenshotOptions)
    timings.screenshot = Date.now() - screenshotStart
    console.log(`⏱️ Screenshot capture: ${timings.screenshot}ms`)
    
    // Set Step 3 completion flag
    if (job) {
      try {
        await job.updateData({ ...job.data, step3Complete: true })
        console.log('✅ Step 3 (Ad Detection & Finalization) completed - flag set')
      } catch (err) {
        console.warn('⚠️ Failed to update job data for Step 3:', err.message)
      }
    }

    // Save screenshot to persistent volume
    const screenshotsDir = path.join(process.cwd(), 'screenshots')
    fileUtils.ensureDir(screenshotsDir)
    
    const screenshotFilename = `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
    const screenshotPath = path.join(screenshotsDir, screenshotFilename)
    
    fs.writeFileSync(screenshotPath, screenshot)

    // Get viewport and screenshot dimensions for header coordinate scaling
    // Header X coordinates are viewport-relative, but full-page screenshot may be wider
    const dimensionInfo = await page.evaluate(() => {
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth,
          document.body.offsetWidth,
          document.documentElement.offsetWidth
        )
      }
    })

    // Header Capture - AFTER SCREENSHOT CAPTURE
    // This ensures header capture doesn't interfere with ad detection or other processes
    const headerCaptureStart = Date.now()
    console.log(`[Header] Starting header capture after screenshot capture...`)
    
    try {
      // Use same screenshots directory as full page screenshots for consistency
      const headerOutputDir = path.join(process.cwd(), 'screenshots')
      fileUtils.ensureDir(headerOutputDir)
      
      const headerResult = await captureHeaderAsync(page, url, device, headerOutputDir)
      timings.headerCapture = Date.now() - headerCaptureStart
      console.log(`⏱️ Header capture: ${timings.headerCapture}ms`)
      
      if (headerResult && headerResult.success) {
        // Calculate scale factor: screenshot width / viewport width
        // Playwright's full-page screenshot width is: Math.max(viewportWidth, scrollWidth)
        // - If content is wider than viewport: screenshot = scrollWidth
        // - If content is narrower than viewport: screenshot = viewportWidth
        const actualScreenshotWidth = Math.max(dimensionInfo.viewportWidth, dimensionInfo.scrollWidth)
        const scaleFactor = actualScreenshotWidth / dimensionInfo.viewportWidth
        console.log('scaleFactor', scaleFactor)
        // Scale header X coordinates to match full-page screenshot dimensions
        const originalHeaderX = headerResult.headerX || 0
        const originalHeaderWidth = headerResult.headerWidth
        const originalHeaderX2 = headerResult.headerX2 || (originalHeaderX + originalHeaderWidth)
        
        const scaledHeaderX = originalHeaderX / scaleFactor
        const scaledHeaderWidth = originalHeaderWidth / scaleFactor
        const scaledHeaderX2 = originalHeaderX2 / scaleFactor
        
        // Convert absolute path to relative URL for frontend
        const headerFilename = path.basename(headerResult.headerPath)
        headerInfo = {
          headerUrl: `/screenshots/${headerFilename}`,
          headerHeight: headerResult.headerHeight,
          headerWidth: Math.round(scaledHeaderWidth), // Scaled width to match full-page screenshot
          headerX: Math.round(scaledHeaderX), // Scaled X1 position for full-page screenshot
          headerX2: Math.round(scaledHeaderX2), // Scaled X2 position (X1 + width)
          originalWidth: originalHeaderWidth, // Original detected width (viewport-relative)
          originalX: originalHeaderX, // Original viewport-relative X position
          viewportWidth: dimensionInfo.viewportWidth, // Store viewport width for reference
          screenshotWidth: actualScreenshotWidth, // Store actual screenshot width (max of viewport and scrollWidth)
          scaleFactor: scaleFactor // Store scale factor for debugging
        }
        console.log(`✅ Header captured: ${headerResult.headerWidth}x${headerResult.headerHeight}`)
        console.log(`📐 Coordinate scaling: viewport=${dimensionInfo.viewportWidth}px, screenshot=${actualScreenshotWidth}px (scrollWidth=${dimensionInfo.scrollWidth}px), scale=${scaleFactor.toFixed(3)}`)
        console.log(`📐 Header X: ${originalHeaderX}px (viewport) → ${Math.round(scaledHeaderX)}px (screenshot)`)
        console.log(`📐 Header width: ${originalHeaderWidth}px (viewport) → ${Math.round(scaledHeaderWidth)}px (screenshot)`)
        console.log(`📋 Header info prepared:`, JSON.stringify(headerInfo, null, 2))
        console.log(`📁 Header file path: ${headerResult.headerPath}`)
        console.log(`🌐 Header URL: ${headerInfo.headerUrl}`)
      } else {
        console.log(`⚠️ Header capture returned null or unsuccessful:`, headerResult)
      }
    } catch (err) {
      timings.headerCapture = Date.now() - headerCaptureStart
      console.warn('⚠️ Header capture error:', err.message)
      // Continue execution even if header capture fails
    }

    // Get page metadata including actual rendered dimensions
    const metadata = await page.evaluate(() => {
      const body = document.body
      const html = document.documentElement
      
      // Get actual content dimensions
      const scrollHeight = Math.max(
        body.scrollHeight,
        html.scrollHeight,
        body.offsetHeight,
        html.offsetHeight,
        body.clientHeight,
        html.clientHeight
      )
      
      const scrollWidth = Math.max(
        body.scrollWidth,
        html.scrollWidth,
        body.offsetWidth,
        html.offsetWidth,
        body.clientWidth,
        html.clientWidth
      )
      
      return {
        title: document.title,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        scrollHeight,
        scrollWidth,
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio || 1,
        screenshot: { 
          width: scrollWidth, 
          height: scrollHeight 
        },
        contentLoaded: {
          images: document.querySelectorAll('img').length,
          iframes: document.querySelectorAll('iframe').length,
          videos: document.querySelectorAll('video').length
        }
      }
    })

    // Calculate total time
    timings.total = Date.now() - timings.start
    
    // Log comprehensive timing breakdown
    console.log('\n📊 ========== PERFORMANCE TIMING BREAKDOWN ==========')
    console.log(`⏱️  Total Time: ${timings.total}ms (${(timings.total / 1000).toFixed(2)}s)`)
    console.log(`   ├─ Navigation: ${timings.navigation}ms (${((timings.navigation / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Header Capture: ${timings.headerCapture}ms (${((timings.headerCapture / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Initial Wait: ${timings.initialWait}ms (${((timings.initialWait / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Top Ad Triggering: ${timings.topAdTriggering}ms (${((timings.topAdTriggering / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ First Consent Attempt: ${timings.consentFirstAttempt}ms (${((timings.consentFirstAttempt / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Eager Loading: ${timings.eagerLoading}ms (${((timings.eagerLoading / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Auto-Scroll: ${timings.autoScroll}ms (${((timings.autoScroll / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Network Idle Check: ${timings.networkIdle}ms (${((timings.networkIdle / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Content Readiness: ${timings.contentReadiness}ms (${((timings.contentReadiness / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Second Consent Attempt: ${timings.consentSecondAttempt}ms (${((timings.consentSecondAttempt / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Popup Closing: ${timings.popupClosing}ms (${((timings.popupClosing / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Selector Ad Detection: ${timings.adDetectionSelector}ms (${((timings.adDetectionSelector / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Claude Ad Detection: ${timings.adDetectionClaude}ms (${((timings.adDetectionClaude / timings.total) * 100).toFixed(1)}%)`)
    console.log(`   └─ Screenshot Capture: ${timings.screenshot}ms (${((timings.screenshot / timings.total) * 100).toFixed(1)}%)`)
    console.log('📊 ===================================================\n')

    // Create cropped screenshot (full page height minus header height from top)
    // Header + cropped image = exact full page dimensions, so ad positions remain unchanged
    let croppedScreenshotUrl = null
    if (headerInfo && headerInfo.headerHeight) {
      const croppedScreenshotStart = Date.now()
      try {
        // Read the existing full-page screenshot buffer
        const screenshotBuffer = fs.readFileSync(screenshotPath)
        
        // Use sharp to crop the full-page screenshot
        const sharp = await import('sharp')
        const screenshotMetadata = await sharp.default(screenshotBuffer).metadata()
        
        const headerHeightPx = headerInfo.headerHeight
        const originalHeight = screenshotMetadata.height
        const originalWidth = screenshotMetadata.width
        const croppedHeight = originalHeight - headerHeightPx
        
        if (croppedHeight > 0 && headerHeightPx < originalHeight) {
          // Crop the full-page screenshot from the top
          const croppedBuffer = await sharp.default(screenshotBuffer)
            .extract({
              left: 0,
              top: headerHeightPx,
              width: originalWidth,
              height: croppedHeight
            })
            .toBuffer()
          
          const croppedFilename = screenshotFilename.replace(/\.(png|jpg)$/, '-cropped.$1')
          const croppedPath = path.join(screenshotsDir, croppedFilename)
          fs.writeFileSync(croppedPath, croppedBuffer)
          croppedScreenshotUrl = `/screenshots/${croppedFilename}`
          const croppedScreenshotTime = Date.now() - croppedScreenshotStart
          console.log(`✂️ Cropped full-page screenshot created: ${croppedFilename} (${originalWidth}x${croppedHeight}, cropped ${headerHeightPx}px from top of ${originalHeight}px full page) in ${croppedScreenshotTime}ms`)
        } else {
          console.warn(`⚠️ Cannot create cropped screenshot: headerHeight (${headerHeightPx}) >= originalHeight (${originalHeight})`)
        }
      } catch (cropErr) {
        console.warn('⚠️ Failed to create cropped screenshot:', cropErr.message)
        // If sharp is not available, try alternative approach
        if (cropErr.message.includes('Cannot find module') || cropErr.message.includes('sharp')) {
          console.warn('⚠️ Sharp not available, skipping cropped screenshot creation')
        }
      }
    } else {
      console.log(`[Header] No header info available, skipping cropped screenshot creation`)
    }
    
    console.log(`[Header] Final headerInfo value:`, headerInfo ? JSON.stringify(headerInfo, null, 2) : 'null')

    const responseData = {
      url,
      device,
      metadata,
      adSlots: finalAdSlots || [], // Use filtered and deduplicated ads
      screenshotUrl: `/screenshots/${screenshotFilename}`,
      timestamp: new Date().toISOString(),
      ...(headerInfo && { 
        header: {
          ...headerInfo,
          ...(croppedScreenshotUrl && { croppedScreenshotUrl }) // Include cropped screenshot URL if available
        }
      }) // Include header info if available
    }
    
    console.log(`✅ Page rendering complete: ${finalAdSlots?.length || 0} ad slots detected for ${url} (${device})`)
    console.log(`📦 Response data keys:`, Object.keys(responseData))
    if (headerInfo) {
      console.log(`📋 Header included in response: ${headerInfo.headerUrl} (${headerInfo.headerWidth}x${headerInfo.headerHeight})`)
      console.log(`📋 Full header object:`, JSON.stringify(headerInfo))
    } else {
      console.log(`⚠️ No header info included in response - headerInfo is null`)
    }
    console.log(`📦 Response data includes header:`, !!responseData.header)
    if (responseData.header) {
      console.log(`📦 Response header object:`, JSON.stringify(responseData.header))
    }
    
    // Log sample slot structure for debugging
    if (finalAdSlots && finalAdSlots.length > 0) {
      const sampleSlot = finalAdSlots[0]
      console.log(`📋 Sample ad slot structure:`, {
        id: sampleSlot.id,
        hasPosition: !!sampleSlot.position,
        positionKeys: sampleSlot.position ? Object.keys(sampleSlot.position) : [],
        position: sampleSlot.position, // Log actual position values
        hasSize: !!sampleSlot.size,
        sizeKeys: sampleSlot.size ? Object.keys(sampleSlot.size) : [],
        size: sampleSlot.size, // Log actual size values
        type: sampleSlot.type
      })
      
      // Log all ad positions for debugging
      console.log(`📊 All ad positions (first 3):`, finalAdSlots.slice(0, 3).map(ad => ({
        id: ad.id,
        position: ad.position,
        size: ad.size
      })))
    }
    
    // Log metadata screenshot dimensions for debugging
    if (metadata && metadata.screenshot) {
      console.log(`📐 Screenshot metadata dimensions:`, {
        width: metadata.screenshot.width,
        height: metadata.screenshot.height,
        scrollWidth: metadata.scrollWidth,
        scrollHeight: metadata.scrollHeight
      })
    }

    // Save to cache if user email is provided
    if (userEmail) {
      await saveCachedPage(userEmail, url, device, responseData)
    }

    return responseData

  } catch (error) {
    // Log error with context before re-throwing
    const elapsedTime = Date.now() - timings.start
    console.error(`❌ Page rendering failed after ${elapsedTime}ms:`, {
      url,
      device,
      error: error.message,
      stack: error.stack,
      scrollCount: scrollCount || 0
    })
    
    // Log partial timing if available
    if (timings.navigation > 0) {
      console.error('📊 Partial timing before failure:', {
        navigation: timings.navigation,
        topAdTriggering: timings.topAdTriggering,
        consentFirstAttempt: timings.consentFirstAttempt,
        autoScroll: timings.autoScroll || 'not started',
        elapsed: elapsedTime
      })
    }
    
    // Re-throw so queue worker can handle it
    throw error
  } finally {
    // Always close the page
    try {
      await page.close()
    } catch (error) {
      console.warn('⚠️ Error closing page:', error.message)
    }
  }
}

