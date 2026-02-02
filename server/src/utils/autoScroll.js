// Auto-scroll utility for handling lazy-loaded content

import { sleep } from './sleep.js'

// Eager-load common lazy resources so content is available without relying solely on scroll
export const eagerLoadLazyResources = async (page) => {
  try {
    // Add timeout protection to prevent hanging
    await Promise.race([
      page.evaluate(async () => {
      const safelySetAttr = (el, name, value) => {
        try { el.setAttribute(name, value) } catch {}
      }

      // Images: convert lazy -> eager and promote data-* to real src/srcset
      const images = Array.from(document.querySelectorAll('img'))
      for (const img of images) {
        safelySetAttr(img, 'loading', 'eager')
        safelySetAttr(img, 'decoding', 'sync')
        if (img.fetchPriority !== 'high') {
          safelySetAttr(img, 'fetchpriority', 'high')
        }
        if (!img.src || img.src.trim() === '' || img.src.startsWith('data:')) {
          const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          if (dataSrc) img.src = dataSrc
        }
        const dataSrcset = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset')
        if (dataSrcset && !img.srcset) img.srcset = dataSrcset

        // Support <picture> sources that hide in data-srcset
        const picture = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null
        if (picture) {
          const sources = picture.querySelectorAll('source')
          sources.forEach(source => {
            const dss = source.getAttribute('data-srcset')
            if (dss && !source.srcset) source.srcset = dss
          })
        }
      }

      // Iframes: promote data-src and disable lazy
      const iframes = Array.from(document.querySelectorAll('iframe'))
      for (const fr of iframes) {
        safelySetAttr(fr, 'loading', 'eager')
        const dataSrc = fr.getAttribute('data-src') || fr.getAttribute('data-lazy-src')
        if (dataSrc && !fr.src) fr.src = dataSrc
      }

      // Video: encourage early buffering
      const videos = Array.from(document.querySelectorAll('video'))
      for (const v of videos) {
        safelySetAttr(v, 'preload', 'auto')
        const dataSrc = v.getAttribute('data-src')
        if (dataSrc && !v.src) v.src = dataSrc
        v.load?.()
      }

      // Elements with background images hidden in data-*
      const candidates = Array.from(document.querySelectorAll('[data-bg], [data-background], [data-bg-src], [data-lazy-background]'))
      for (const el of candidates) {
        const bg = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-bg-src') || el.getAttribute('data-lazy-background')
        if (bg) {
          const style = el.style || {}
          if (style) style.backgroundImage = `url("${bg}")`
        }
      }

      // Common lazy CSS classes/attributes toggles
      const lazySelectors = [
        '.lazy', '.lazyload', '.js-lazy', '.lozad', '[lazyload]', '[data-lazy]'
      ]
      document.querySelectorAll(lazySelectors.join(','))
        .forEach(el => {
          try {
            // Many libraries watch for class removal to trigger load
            el.classList?.remove('lazy', 'lazyload', 'js-lazy', 'lozad')
            el.classList?.add('lazyloaded')
          } catch {}
        })

      // Dispatch events that many lazy libraries listen to
      const fire = (type) => {
        try { window.dispatchEvent(new Event(type)) } catch {}
        try { document.dispatchEvent(new Event(type)) } catch {}
      }
      fire('scroll')
      fire('resize')
      fire('orientationchange')
      fire('load')

      // Give the browser a brief microtask break to kick off fetches
      await new Promise(r => setTimeout(r, 0))
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Eager load evaluation timeout')), 2000)) // Reduced to 2s
    ])
  } catch (e) {
    // Don't throw - eager loading is best effort, log and continue
    if (e.message && e.message.includes('timeout')) {
      console.warn('⚠️ Eager load evaluation timed out (continuing anyway)')
    } else {
      console.warn('⚠️ Error during eager-load evaluation:', e.message || e)
    }
  }
}

export const autoScroll = async (page, options = {}) => {
  const {
    scrollDelay = 700,
    scrollStep = 900,
    maxScrolls = 85,
    waitForImages = true,
    waitForNetwork = true
  } = options

  try {
    console.log('Starting auto-scroll to load lazy content...')
    
    // Brief initial pause (reduced from 1000ms to 500ms)
    await sleep(900)

    // Proactively eager-load lazy resources before we start scrolling
    await eagerLoadLazyResources(page)
    
    let previousHeight = 0
    let scrollCount = 0
    let stableCount = 0
    let maxHeight = 0
    
    // First phase: aggressive scroll to bottom with better detection
    console.log('Phase 1: Scrolling to bottom...')
    while (scrollCount < maxScrolls) {
      // Get current page height and scroll position
      const { currentHeight, scrollY, viewportHeight } = await page.evaluate(() => {
        return {
          currentHeight: Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.offsetHeight,
            document.body.clientHeight,
            document.documentElement.clientHeight
          ),
          scrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
          viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0
        }
      })
      
      // Track maximum height seen
      if (currentHeight > maxHeight) {
        maxHeight = currentHeight
        stableCount = 0 // Reset stable count when height increases
      }
      
      // If height hasn't changed, increment stable count
      if (currentHeight === previousHeight) {
        stableCount++
        // Only stop if we're near the bottom AND height is stable
        const nearBottom = scrollY + viewportHeight >= currentHeight - 100
        if (stableCount >= 5 && nearBottom) {
          console.log('Page height stable and at bottom, stopping scroll')
          break
        }
      } else {
        stableCount = 0
        previousHeight = currentHeight
      }
      
      // Scroll down more aggressively
      await page.evaluate(({ step }) => {
        window.scrollBy(0, step)
      }, { step: scrollStep })
      
      // Eager-load newly introduced lazy resources on every scroll
      await eagerLoadLazyResources(page)

      // Wait for content to load (reduced delay)
      await sleep(scrollDelay)
      
      // Wait for images to load if specified (but faster)
      if (waitForImages && scrollCount % 2 === 0) { // Only every other scroll
        await page.evaluate(() => {
          return Promise.all(
            Array.from(document.images)
              .filter(img => {
                const rect = img.getBoundingClientRect()
                return !img.complete && rect.width > 0 && rect.height > 0
              })
              .slice(0, 20) // Limit to first 20 to avoid blocking
              .map(img => {
                return new Promise((resolve) => {
                  img.onload = resolve
                  img.onerror = resolve
                  setTimeout(resolve, 1500) // Reduced timeout
                })
              })
          )
        })
      }
      
      scrollCount++
      if (scrollCount % 10 === 0 || scrollCount === 1) {
        console.log(`Scroll ${scrollCount}/${maxScrolls}, height: ${currentHeight}`)
      }
    }
    
    // Second phase: Random scrolling to trigger any remaining lazy content (reduced time)
    console.log('Phase 2: Random scrolling for 3 seconds...')
    const randomScrollStart = Date.now()
    while (Date.now() - randomScrollStart < 3000) {
      const direction = Math.random() > 0.5 ? 1 : -1
      const distance = Math.floor(Math.random() * 400) + 200
      await page.evaluate(({ dir, dist }) => {
        window.scrollBy(0, dir * dist)
      }, { dir: direction, dist: distance })
      await sleep(150)
    }
    
    // Final scroll to very bottom to ensure all content is triggered
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight)
    })
    await sleep(500)
    
    // Scroll back to top
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
    
    // Brief final wait
    await sleep(500)
    
    console.log(`Auto-scroll completed after ${scrollCount} scrolls, max height: ${maxHeight}`)
    
  } catch (error) {
    console.error('Error during auto-scroll:', error)
    // Don't throw error, just log it and continue
  }
}

// Alternative scroll method for specific elements
export const scrollToElement = async (page, selector, options = {}) => {
  const {
    timeout = 10000,
    scrollDelay = 500
  } = options
  
  try {
    await page.waitForSelector(selector, { timeout })
    
    await page.evaluate(({ sel }) => {
      const element = document.querySelector(sel)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, { sel: selector })
    
    await sleep(scrollDelay)
    
  } catch (error) {
    console.error(`Error scrolling to element ${selector}:`, error)
  }
}

// Scroll to specific position
export const scrollToPosition = async (page, x = 0, y = 0) => {
  try {
    await page.evaluate(({ scrollX, scrollY }) => {
      window.scrollTo(scrollX, scrollY)
    }, { scrollX: x, scrollY: y })
    
    await sleep(500)
    
  } catch (error) {
    console.error('Error scrolling to position:', error)
  }
}

// Wait for specific content to load
export const waitForContent = async (page, options = {}) => {
  const {
    minImages = 0,
    minElements = 0,
    timeout = 10000
  } = options
  
  try {
    await page.waitForFunction(
      (minImg, minEl) => {
        const images = document.querySelectorAll('img')
        const elements = document.querySelectorAll('*')
        return images.length >= minImg && elements.length >= minEl
      },
      { timeout },
      minImages,
      minElements
    )
  } catch (error) {
    console.error('Error waiting for content:', error)
  }
}

// Deep scroll to bottom until page height stabilizes
export const deepScrollToBottom = async (page, { maxLoops = 60, delayMs = 300 } = {}) => {
  let lastHeight = 0
  for (let i = 0; i < maxLoops; i++) {
    const height = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      )
    })
    if (height === lastHeight) break
    lastHeight = height
    await sleep(delayMs)
  }
}

// Jitter scroll up/down for duration to trigger lazy content
export const jitterScroll = async (page, durationMs = 5000) => {
  const start = Date.now()
  while (Date.now() - start < durationMs) {
    await page.evaluate(() => {
      const delta = Math.floor(Math.random() * 400) + 200
      const dir = Math.random() > 0.5 ? 1 : -1
      window.scrollBy(0, dir * delta)
    })
    await sleep(300)
  }
}

// Normalize bottom-fixed/sticky bars so they appear once in full-page screenshots
// Strategy: after a final scroll-to-bottom, convert bottom-anchored fixed/sticky elements
// into absolutely positioned nodes at their document-space Y near the bottom of the page.
/*
export const normalizeStickyBottomElements = async (page) => {
  try {
    await page.evaluate(() => {
      const isBottomAnchored = (cs) => {
        const b = cs.bottom
        return b === '0px' || b === '0' || b === 'auto 0px' || b === 'auto 0'
      }

      const candidates = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const cs = window.getComputedStyle(el)
          if (!cs) return false
          const pos = cs.position
          if (!(pos === 'fixed' || pos === 'sticky')) return false
          // Only bottom anchored items
          return isBottomAnchored(cs)
        })

      const pageHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      )

      candidates.forEach(el => {
        try {
          const cs = window.getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          const currentViewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
          const intendedHeight = rect.height
          const documentBottomY = pageHeight - intendedHeight

          // Compute absolute left using current rect and scrollX
          const left = rect.left + (window.pageXOffset || document.documentElement.scrollLeft || 0)

          // Lock width to current pixel width to avoid reflow surprises
          const width = Math.round(rect.width)

          // Convert to absolute at the bottom of the document
          el.style.position = 'absolute'
          el.style.top = `${Math.max(0, documentBottomY)}px`
          el.style.bottom = 'auto'
          el.style.left = `${Math.max(0, Math.round(left))}px`
          
          if (!cs.width || cs.width.endsWith('%') || cs.width.endsWith('vw')) {
            el.style.width = `${width}px`
          }
          // Ensure it paints above content but avoid absurd z-index
          const currentZ = parseInt(cs.zIndex || '0', 10)
          if (!Number.isFinite(currentZ) || currentZ < 10) {
            el.style.zIndex = '10'
          }
        } catch (_) {}
      })
    })
  } catch (e) {
    console.error('Error normalizing sticky bottom elements:', e)
  }
}
*/
