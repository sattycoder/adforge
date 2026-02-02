// Utilities to reduce cookie/consent popups

import { sleep } from './sleep.js'

/**
 * Attempt to set permissive cookies before navigation (best-effort; domain-scoped)
 * @param {object} page - Playwright page object
 * @param {string} url - Target URL
 */
export const setPreConsentCookies = async (page, url) => {
  try {
    const u = new URL(url)
    const domain = u.hostname.replace(/^www\./, '')
    const cookies = [
      // Generic flags some frameworks honor
      { name: 'cookie_consent', value: 'accepted', domain: '.' + domain, path: '/', httpOnly: false },
      { name: 'consent', value: 'yes', domain: '.' + domain, path: '/', httpOnly: false },
      { name: 'OptanonAlertBoxClosed', value: 'true', domain: '.' + domain, path: '/', httpOnly: false },
      { name: 'OptanonConsent', value: 'isIABGlobal=false&datestamp=' + Date.now(), domain: '.' + domain, path: '/', httpOnly: false },
    ]
    // In Playwright, cookies are set on the context
    const context = page.context()
    await context.addCookies(cookies)
  } catch (_) {
    // Silently fail if cookie setting doesn't work
  }
}

/**
 * Remove sticky bottom elements (ads, banners, etc.)
 * 
 * NOTE: All cleanup functionality is currently disabled (commented out)
 * 
 * @param {object} page - Playwright page object
 * @param {object} options - Configuration options
 * @param {boolean} options.removeSticky - When false, skips sticky-bottom cleanup (default: true)
 * @returns {Promise<boolean>} True if elements were deleted, false otherwise
 */
export const dismissConsentPopups = async (
  page,
  { removeSticky = true } = {}
) => {
  // All cleanup functionality is currently disabled
  console.log(`[consent] All cleanup functionality is disabled`)
  return false
  
  // ============================================================================
  // COMMENTED OUT: Cookie word, overlay, scroll unlock, and sticky removal logic
  // ============================================================================
  // The following sections are commented out as they are not currently needed:
  // 1. Cookie-word component removal
  // 2. Overlay/modal component removal
  // 3. Scroll unlock functionality
  // 4. Sticky element removal
  //
  // These can be re-enabled by uncommenting the code below if needed.
  // ============================================================================
  
  // let totalDeleted = 0
  // 
  // // Cookie word removal (commented out)
  // for (let i = 0; i < attempts; i++) {
  //   try {
  //     // 1) Remove cookie-word components (toggleable)
  //     const result = REMOVE_COOKIE_WORD && removeContent
  //       ? await page.evaluate(() => {
  //           const lc = (s) => String(s || '').toLowerCase()
  //           let deletedCount = 0
  //           const containsCookie = (element) => {
  //             const textContent = lc(String(element.innerText || element.textContent || ''))
  //             const ariaLabel = lc(String(element.getAttribute('aria-label') || ''))
  //             const title = lc(String(element.getAttribute('title') || ''))
  //             const placeholder = lc(String(element.getAttribute('placeholder') || ''))
  //             const className = lc(String(element.className || ''))
  //             const id = lc(String(element.id || ''))
  //             return (
  //               textContent.includes('cookie') ||
  //               ariaLabel.includes('cookie') ||
  //               title.includes('cookie') ||
  //               placeholder.includes('cookie') ||
  //               className.includes('cookie') ||
  //               id.includes('cookie')
  //             )
  //           }
  //           const removeElement = (element) => {
  //             try {
  //               if (element && element.parentNode) {
  //                 element.parentNode.removeChild(element)
  //                 deletedCount++
  //                 return true
  //               }
  //             } catch (e) { console.warn('Could not remove element:', e) }
  //             return false
  //           }
  //           const allElements = Array.from(document.querySelectorAll('*'))
  //           for (let j = allElements.length - 1; j >= 0; j--) {
  //             const element = allElements[j]
  //             if (containsCookie(element)) removeElement(element)
  //           }
  //           const shadowHosts = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot)
  //           for (const host of shadowHosts) {
  //             const shadowElements = Array.from(host.shadowRoot.querySelectorAll('*'))
  //             for (let k = shadowElements.length - 1; k >= 0; k--) {
  //               const element = shadowElements[k]
  //               if (containsCookie(element)) removeElement(element)
  //             }
  //           }
  //           return deletedCount
  //         })
  //       : 0
  //     
  //     totalDeleted += result
  //     
  //     if (result > 0) {
  //       console.log(`✅ Deleted ${result} cookie-related elements (attempt ${i + 1})`)
  //     }
  //     
  //     // 2) Remove overlay/modal components (toggleable)
  //     const overlayResult = REMOVE_OVERLAYS && removeContent
  //       ? await page.evaluate(() => {
  //           const lc = (s) => String(s || '').toLowerCase()
  //           let deletedCount = 0
  //           const isOverlayElement = (element) => {
  //             if (!element) return false
  //             const className = lc(String(element.className || ''))
  //             const id = lc(String(element.id || ''))
  //             let computedStyle
  //             try {
  //               computedStyle = window.getComputedStyle(element)
  //             } catch (e) {
  //               return false
  //             }
  //             const overlayPatterns = [
  //               'cookie','consent','gdpr','privacy','policy',
  //               'accept-cookie','cookiebanner','cookie-bar', 'modal',
  //               'cookie-notice','cookie-popup','cookie-consent','cookie-settings'
  //             ]
  //             const hasOverlayPattern = overlayPatterns.some(pattern => className.includes(pattern) || id.includes(pattern))
  //             const isFullScreen = (
  //               (computedStyle.position === 'fixed' || computedStyle.position === 'absolute') &&
  //               (computedStyle.top === '0px' || computedStyle.top === '0') &&
  //               (computedStyle.left === '0px' || computedStyle.left === '0') &&
  //               (computedStyle.width === '100%' || computedStyle.width === '100vw' || 
  //                parseInt(computedStyle.width) >= window.innerWidth * 0.8) &&
  //               (computedStyle.height === '100%' || computedStyle.height === '100vh' || 
  //                parseInt(computedStyle.height) >= window.innerHeight * 0.8)
  //             )
  //             const hasHighZIndex = parseInt(computedStyle.zIndex) > 1000
  //             const hasOverlayBackground = (
  //               computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
  //               computedStyle.backgroundColor !== 'transparent' &&
  //               (computedStyle.opacity !== '1' || computedStyle.backgroundColor.includes('rgba'))
  //             )
  //             return hasOverlayPattern || (isFullScreen && (hasHighZIndex || hasOverlayBackground))
  //           }
  //           const removeElement = (element) => {
  //             try {
  //               if (element && element.parentNode) {
  //                 element.parentNode.removeChild(element)
  //                 deletedCount++
  //                 return true
  //               }
  //             } catch (e) { console.warn('Could not remove overlay element:', e) }
  //             return false
  //           }
  //           const allElements = Array.from(document.querySelectorAll('*'))
  //           for (let j = allElements.length - 1; j >= 0; j--) {
  //             const element = allElements[j]
  //             if (element && isOverlayElement(element)) removeElement(element)
  //           }
  //           const shadowHosts = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot)
  //           for (const host of shadowHosts) {
  //             const shadowElements = Array.from(host.shadowRoot.querySelectorAll('*'))
  //             for (let k = shadowElements.length - 1; k >= 0; k--) {
  //               const element = shadowElements[k]
  //               if (isOverlayElement(element)) removeElement(element)
  //             }
  //           }
  //           return deletedCount
  //         })
  //       : 0
  //     
  //     totalDeleted += overlayResult
  //     
  //     if (overlayResult > 0) {
  //       console.log(`🎭 Deleted ${overlayResult} overlay/modal elements (attempt ${i + 1})`)
  //     }
  //     
  //     // 3) Ensure page scrolling is unlocked on html/body
  //     let unlockResult = 0
  //     if (unlockScroll) {
  //       unlockResult = await page.evaluate(() => {
  //         let changes = 0
  //         const roots = [document.documentElement, document.body].filter(root => root !== null)
  //         const lockClasses = [
  //           'modal-open', 'no-scroll', 'noscroll', 'overflow-hidden', 'scroll-lock',
  //           'disable-scroll', 'cmp-shown', 'cmp-active', 'didomi-popup-open', 'fc-consent-active',
  //           'has-overlay', 'is-locked', 'lock-scroll'
  //         ]
  //         const unset = (el, prop) => {
  //           try { if (el && el.style) { el.style.setProperty(prop, ''); changes++ } } catch (_) {}
  //         }
  //         const setImportant = (el, prop, value) => {
  //           try { if (el && el.style) { el.style.setProperty(prop, value, 'important'); changes++ } } catch (_) {}
  //         }
  //
  //         for (const root of roots) {
  //           if (!root || !root.classList) continue
  //           
  //           // Remove common lock classes
  //           lockClasses.forEach(cls => { 
  //             try {
  //               if (root.classList && root.classList.contains(cls)) {
  //                 root.classList.remove(cls)
  //                 changes++
  //               }
  //             } catch (_) {}
  //           })
  //
  //           try {
  //             const cs = window.getComputedStyle(root)
  //             // Normalize overflow
  //             if (cs.overflow !== 'visible' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') {
  //               setImportant(root, 'overflow', 'auto')
  //               setImportant(root, 'overflow-y', 'auto')
  //               setImportant(root, 'overflow-x', 'auto')
  //             }
  //             // Normalize height/position that can prevent scrolling
  //             if (cs.height === '100%') setImportant(root, 'height', 'auto')
  //             if (cs.position === 'fixed') setImportant(root, 'position', 'static')
  //             unset(root, 'overscroll-behavior')
  //           } catch (_) {}
  //         }
  //
  //         // Some frameworks apply locks on a wrapper element; try to find and fix obvious ones
  //         try {
  //           const wrappers = Array.from(document.querySelectorAll('[class*="wrapper" i], [class*="content" i], [class*="container" i]'))
  //           wrappers.slice(0, 5).forEach(el => {
  //             if (!el || !el.classList) return
  //             try {
  //               const cs = window.getComputedStyle(el)
  //               if (cs.overflowY === 'hidden') setImportant(el, 'overflow-y', 'auto')
  //               if (cs.height === '100%') setImportant(el, 'height', 'auto')
  //             } catch (_) {}
  //           })
  //         } catch (_) {}
  //
  //         return changes
  //       })
  //
  //       if (unlockResult > 0) {
  //         console.log(`🧹 Unlocked page scroll by applying ${unlockResult} style/class fixes`)
  //       }
  //     }
  //     
  //     // If no elements were deleted in this attempt, we can stop trying
  //     if (result === 0 && overlayResult === 0 && unlockResult === 0 && stickyResult === 0 && i > 0) {
  //       break
  //     }
  //     
  //   } catch (error) {
  //     console.warn('Error during cookie element deletion:', error)
  //   }
  //   
  //   // Wait before next attempt to allow dynamic content to load
  //   if (i < attempts - 1) {
  //     await sleep(delayMs)
  //   }
  // }
  
  // ============================================================================
  // COMMENTED OUT: Sticky element removal
  // ============================================================================
  // Sticky bottom elements removal is now commented out
  // This can be re-enabled by uncommenting the code below if needed
  // ============================================================================
  
  // if (removeSticky) {
  //   const stickyResult = await page.evaluate(() => {
  //     const lc = (s) => String(s || '').toLowerCase()
  //     let deletedCount = 0
  //
  //     /**
  //      * Check if element is likely a sticky element (bottom ad, banner, etc.)
  //      * @param {HTMLElement} element - Element to check
  //      * @returns {boolean} True if element matches sticky patterns
  //      */
  //     const isStickyElement = (element) => {
  //       if (!element) return false
  //       
  //       const className = lc(String(element.className || ''))
  //       const id = lc(String(element.id || ''))
  //       
  //       let computedStyle
  //       try {
  //         computedStyle = window.getComputedStyle(element)
  //       } catch (e) {
  //         return false // If we can't get computed style, skip this element
  //       }
  //       
  //       // Check for sticky-related patterns in class names and IDs
  //       const stickyPatterns = [
  //         'stickybottom', 'bottomsticky', 'bottom-sticky', 'stickybottomad',
  //         'sticky-bottom', 'bottom-ad', 'bottomad', 'floating', 'ob-widget-items-container'
  //       ]
  //       
  //       const hasStickyPattern = stickyPatterns.some(pattern =>
  //         className.includes(pattern) || id.includes(pattern)
  //       )
  //       
  //       // Check if element has sticky/fixed positioning
  //       const isStickyPositioned = (
  //         computedStyle.position === 'sticky' || 
  //         computedStyle.position === 'fixed'
  //       )
  //       
  //       // Check for bottom positioning (common for sticky ads)
  //       const isBottomPositioned = (
  //         computedStyle.bottom === '0px' ||
  //         computedStyle.bottom === '0' ||
  //         computedStyle.bottom === '0px !important' ||
  //         computedStyle.bottom === '0 !important'
  //       )
  //       
  //       // Check for full-width bottom positioning (left: 0; right: 0; bottom: 0)
  //       const isFullWidthBottomPositioned = (
  //         isBottomPositioned &&
  //         (computedStyle.left === '0px' || computedStyle.left === '0') &&
  //         (computedStyle.right === '0px' || computedStyle.right === '0')
  //       )
  //       
  //       // Check for ad-related attributes
  //       const hasAdAttributes = className.includes('bottomsticky')
  //
  //       return (
  //         hasStickyPattern || 
  //         hasAdAttributes ||
  //         (isStickyPositioned && isBottomPositioned) ||
  //         (hasAdAttributes && isStickyPositioned) ||
  //         (isFullWidthBottomPositioned && hasAdAttributes)
  //       )
  //     }
  //
  //     /**
  //      * Safely remove element from DOM
  //      * @param {HTMLElement} element - Element to remove
  //      * @returns {boolean} True if element was removed successfully
  //      */
  //     const removeElement = (element) => {
  //       try {
  //         if (element && element.parentNode) {
  //           element.parentNode.removeChild(element)
  //           deletedCount++
  //           return true
  //         }
  //       } catch (e) {
  //         console.warn('Could not remove sticky element:', e)
  //       }
  //       return false
  //     }
  //
  //     // Scan all elements for sticky elements
  //     const allElements = Array.from(document.querySelectorAll('*'))
  //     
  //     // Process elements in reverse order (children first to avoid orphaned elements)
  //     for (let j = allElements.length - 1; j >= 0; j--) {
  //       const element = allElements[j]
  //       if (isStickyElement(element)) {
  //         removeElement(element)
  //       }
  //     }
  //
  //     // Also scan shadow DOM elements
  //     const shadowHosts = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot)
  //     for (const host of shadowHosts) {
  //       const shadowElements = Array.from(host.shadowRoot.querySelectorAll('*'))
  //       for (let k = shadowElements.length - 1; k >= 0; k--) {
  //         const element = shadowElements[k]
  //         if (isStickyElement(element)) {
  //           removeElement(element)
  //         }
  //       }
  //     }
  //
  //     return deletedCount
  //   })
  //
  //   totalDeleted += stickyResult
  //
  //   if (stickyResult > 0) {
  //     console.log(`📌 Deleted ${stickyResult} sticky elements`)
  //   }
  // }
  // 
  // // Return result
  // if (totalDeleted > 0) {
  //   console.log(`🎯 Total deleted: ${totalDeleted} sticky elements`)
  //   return true
  // }
  // 
  // return false
}
