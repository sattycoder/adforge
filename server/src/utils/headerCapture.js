import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import fs from 'fs'
import path from 'path'

/**
 * Header Detection and Capture
 * 
 * Detects website headers using hardcoded patterns first, then Claude AI fallback.
 * Captures header screenshots for sticky header display in UI.
 */

let bedrockClient = null

// Initialize AWS Bedrock client
function getBedrockClient() {
  if (bedrockClient) return bedrockClient

  const config = {
    region: process.env.AWS_BEDROCK_REGION || 'eu-central-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }

  bedrockClient = new BedrockRuntimeClient(config)
  return bedrockClient
}

/**
 * Take optimized screenshot (JPEG with PNG fallback)
 */
async function takeOptimizedScreenshot(page, clip = null) {
  try {
    const options = {
      fullPage: false,
      type: 'jpeg',
      quality: 85,
    }
    if (clip) {
      options.clip = clip
    }
    const screenshot = await page.screenshot(options)
    return screenshot
  } catch (error) {
    // Fallback to PNG if JPEG fails
    try {
      const options = {
        fullPage: false,
        type: 'png',
      }
      if (clip) {
        options.clip = clip
      }
      return await page.screenshot(options)
    } catch (pngError) {
      throw new Error(`Screenshot failed: ${error.message}`)
    }
  }
}

/**
 * Detect header using hardcoded patterns
 * @param {Page} page - Playwright page instance
 * @param {string} url - Page URL
 * @returns {Promise<{found: boolean, bounds: {x, y, width, height}}>}
 */
async function detectHeaderWithHardcodedPatterns(page, url) {
  try {
    // Ensure we're at the top of the page
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    })
    await new Promise(resolve => setTimeout(resolve, 100)) // Brief wait for scroll

    const result = await page.evaluate(() => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Common header selectors
      const headerSelectors = [
        'header',
        '[role="banner"]',
        '.header',
        '.topNav',
        '#topNav',
        '#header',
        '.site-header',
        '.main-header',
        '.page-header',
        '.site-nav',
        '.navigation',
        '.nav-header',
        '.id-SiteHeader', 
        '[class*="SiteHeader"]', // Generic site header pattern
        '[id*="SiteHeader"]', // Generic site header ID pattern
        '[class*="site-header"]', // Generic site header class pattern
        '[id*="site-header"]', // Generic site header ID pattern
        '[class*="mobile-global-navigation"]', // Mobile global navigation
        '[class*="global-top-navigation"]' // Global top navigation
      ]

      let headerElement = null
      
      // Try each selector
      for (const selector of headerSelectors) {
        const elements = Array.from(document.querySelectorAll(selector))
        for (const el of elements) {
          const rect = el.getBoundingClientRect()
          // Validate: must be in top 400px, visible in viewport, and have reasonable dimensions
          if (rect.top >= 0 && 
              rect.top < 400 && 
              rect.left >= 0 &&
              rect.left < viewportWidth &&
              rect.right > 0 &&
              rect.right <= viewportWidth &&
              rect.width > 100 && 
              rect.height > 20 &&
              rect.height < 2000 &&
              rect.width <= viewportWidth) {
            headerElement = el
            break
          }
        }
        if (headerElement) break
      }

      // If no header found, look for elements with data-module-id containing header/appbar/nav
      if (!headerElement) {
        const moduleElements = Array.from(document.querySelectorAll('[data-module-id]'))
        for (const el of moduleElements) {
          const moduleId = (el.getAttribute('data-module-id') || '').toLowerCase()
          if (moduleId.includes('header') || 
              moduleId.includes('appbar') || 
              moduleId.includes('navigation') ||
              moduleId.includes('nav') ||
              moduleId.includes('bar')) {
            const rect = el.getBoundingClientRect()
            if (rect.top >= 0 && 
                rect.top < 400 && 
                rect.left >= 0 &&
                rect.left < viewportWidth &&
                rect.right > 0 &&
                rect.right <= viewportWidth &&
                rect.width > 200 && 
                rect.height > 20 &&
                rect.height < 2000 &&
                rect.width <= viewportWidth) {
              headerElement = el
              break
            }
          }
        }
      }

      // If no header found, look for elements with data-module-id containing header/appbar/nav
      if (!headerElement) {
        const moduleElements = Array.from(document.querySelectorAll('[data-module-id*="header"], [data-module-id*="Header"], [data-module-id*="appbar"], [data-module-id*="AppBar"], [data-module-id*="nav"], [data-module-id*="Nav"]'))
        for (const el of moduleElements) {
          const rect = el.getBoundingClientRect()
          if (rect.top >= 0 && 
              rect.top < 400 && 
              rect.left >= 0 &&
              rect.left < viewportWidth &&
              rect.right > 0 &&
              rect.right <= viewportWidth &&
              rect.width > 200 && 
              rect.height > 20 &&
              rect.height < 2000 &&
              rect.width <= viewportWidth) {
            headerElement = el
            break
          }
        }
      }

      // If still no header found, look for logo with href to root/index (including full URLs)
      if (!headerElement) {
        const baseUrl = window.location.origin
        const rootPaths = ['/', '/index', '/index.html']
        
        // Find all links that could point to homepage
        const allLinks = Array.from(document.querySelectorAll('a[href]'))
        const logoLinks = allLinks.filter(link => {
          const href = link.getAttribute('href') || ''
          // Check for relative paths
          if (rootPaths.some(path => href === path || href.startsWith(path + '?'))) {
            return true
          }
          // Check for full URL pointing to root (e.g., https://www.waz.de/ or https://www.waz.de)
          const normalizedHref = href.trim()
          if (normalizedHref === baseUrl || 
              normalizedHref === baseUrl + '/' || 
              normalizedHref.startsWith(baseUrl + '/?') ||
              normalizedHref.startsWith(baseUrl + '#')) {
            return true
          }
          // Check for aria-label indicating homepage (German: "Zur Startseite", English: "Home", etc.)
          const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase()
          if (ariaLabel.includes('startseite') || 
              ariaLabel.includes('home') ||
              ariaLabel.includes('homepage') ||
              ariaLabel.includes('main page') ||
              ariaLabel.includes('logo')) {
            return true
          }
          // Check if link contains logo image
          const hasLogoImg = link.querySelector('img[src*="logo"], img[alt*="logo" i], img[class*="logo" i]')
          if (hasLogoImg) {
            return true
          }
          return false
        })

        for (const link of logoLinks) {
          const rect = link.getBoundingClientRect()
          if (rect.top >= 0 && 
              rect.top < 400 && 
              rect.left >= 0 &&
              rect.left < viewportWidth &&
              rect.width > 0 && 
              rect.height > 0) {
            // Find parent container (header-like element) - traverse up more levels
            let parent = link.parentElement
            let depth = 0
            let bestParent = null
            let bestScore = 0
            
            while (parent && depth < 10) {
              const parentRect = parent.getBoundingClientRect()
              const tagName = parent.tagName.toLowerCase()
              const className = (parent.className || '').toLowerCase()
              const id = (parent.id || '').toLowerCase()
              const dataModuleId = (parent.getAttribute('data-module-id') || '').toLowerCase()
              
              // Check if this is a header/nav element or has header-like identifiers
              const isHeaderLike = tagName === 'header' || 
                                   tagName === 'nav' ||
                                   className.includes('header') || 
                                   className.includes('nav') || 
                                   className.includes('appbar') ||
                                   className.includes('siteheader') ||
                                   id.includes('header') || 
                                   id.includes('nav') || 
                                   id.includes('appbar') ||
                                   id.includes('siteheader') ||
                                   dataModuleId.includes('header') || 
                                   dataModuleId.includes('nav') || 
                                   dataModuleId.includes('appbar')
              
              if (parentRect.top >= 0 && 
                  parentRect.top < 400 && 
                  parentRect.left >= 0 &&
                  parentRect.left < viewportWidth &&
                  parentRect.width > 200 && 
                  parentRect.height > 30 &&
                  parentRect.width <= viewportWidth) {
                
                // Score this parent based on how header-like it is
                let score = parentRect.width * parentRect.height
                
                // Strong preference for actual <header> or <nav> tags
                if (tagName === 'header') {
                  score *= 5
                } else if (tagName === 'nav') {
                  score *= 4
                }
                
                // Boost score for header-like identifiers
                if (isHeaderLike) {
                  score *= 3
                }
                
                // Prefer elements that contain the logo (not too far up the tree)
                if (depth < 5) {
                  score *= 1.5
                }
                
                if (score > bestScore) {
                  bestScore = score
                  bestParent = parent
                }
              }
              parent = parent.parentElement
              depth++
            }
            
            if (bestParent) {
              headerElement = bestParent
              break
            }
          }
        }
      }

      if (!headerElement) {
        return { found: false, bounds: null }
      }

      const rect = headerElement.getBoundingClientRect()
      
      // Check if logo is bigger than main navigation component height
      // If so, we need to include breadcrumb navigation below
      const logoElements = headerElement.querySelectorAll('img[src*="logo"], img[alt*="logo" i], img[class*="logo" i], a[href="/"] img, a[href="/index"] img, a[href*="/"] img')
      let maxLogoHeight = 0
      let mainNavHeight = 0
      
      // Find max logo height within header
      for (const logo of logoElements) {
        const logoRect = logo.getBoundingClientRect()
        if (logoRect.height > maxLogoHeight) {
          maxLogoHeight = logoRect.height
        }
      }
      
      // Find main navigation height (nav elements within header)
      const navElements = headerElement.querySelectorAll('nav[role="navigation"], nav:not([id*="breadcrumb"]), .main-nav, .top-nav, .site-nav')
      for (const nav of navElements) {
        const navRect = nav.getBoundingClientRect()
        if (navRect.height > mainNavHeight) {
          mainNavHeight = navRect.height
        }
      }
      
      // Check if logo is bigger than nav (compensation needed)
      const needsBreadcrumbCompensation = maxLogoHeight > mainNavHeight && maxLogoHeight > 0
      
      // Check if there are breadcrumbs or other header-related elements below
      // that should be included to avoid cropping (especially when logo is bigger than nav)
      const headerBottom = rect.bottom
      const breadcrumbSelectors = [
        'nav[id*="breadcrumb" i]',
        'nav[role="navigation"][id*="breadcrumb" i]',
        '.breadcrumb',
        '.breadcrumbs',
        '[class*="breadcrumb" i]',
        '[id*="breadcrumb" i]'
      ]
      const relatedElements = Array.from(document.querySelectorAll(breadcrumbSelectors.join(', ')))
      let maxBottom = headerBottom
      
      for (const el of relatedElements) {
        const elRect = el.getBoundingClientRect()
        // If element is directly below header (within 50px) and in top portion of page
        // OR if logo is bigger than nav and this is a breadcrumb (compensation case)
        const isBreadcrumb = el.id?.toLowerCase().includes('breadcrumb') || 
                            el.className?.toLowerCase().includes('breadcrumb') ||
                            (el.tagName === 'NAV' && el.getAttribute('role') === 'navigation' && el.id?.toLowerCase().includes('breadcrumb'))
        
        const shouldInclude = (elRect.top >= headerBottom && 
            elRect.top <= headerBottom + 50 && 
            elRect.top < 400 &&
            elRect.left >= rect.left - 50 && 
            elRect.right <= rect.right + 50) ||
            (needsBreadcrumbCompensation && isBreadcrumb && 
             elRect.top >= headerBottom && 
             elRect.top <= headerBottom + 100 && // Allow up to 100px gap for breadcrumb
             elRect.top < 500) // Allow breadcrumb to be slightly lower when compensating
        
        if (shouldInclude) {
          maxBottom = Math.max(maxBottom, elRect.bottom)
          // Note: console.log inside page.evaluate() won't appear in Node.js logs
        }
      }
      
      // No padding - component detection includes enough area
      // Use viewport-relative coordinates (getBoundingClientRect) for screenshot clipping
      // Ensure bounds are within viewport
      const bounds = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.min(Math.round(rect.width), viewportWidth - Math.max(0, rect.left)),
        height: Math.round(maxBottom - rect.top)
      }

      // Ensure height doesn't exceed reasonable header size (500px max)
      if (bounds.height > 500) {
        bounds.height = Math.round(rect.height)
      }

      // Final validation: ensure bounds are valid and within viewport
      if (bounds.x < 0 || bounds.y < 0 || 
          bounds.x >= viewportWidth || 
          bounds.y >= viewportHeight ||
          bounds.width <= 0 || bounds.height <= 0 ||
          bounds.x + bounds.width > viewportWidth ||
          bounds.y + bounds.height > viewportHeight) {
        return { found: false, bounds: null }
      }

      return {
        found: true,
        bounds
      }
    })

    return result
  } catch (error) {
    console.warn('[Header] Hardcoded detection error:', error.message)
    return { found: false, bounds: null }
  }
}

/**
 * Detect header using Claude AI
 * @param {Page} page - Playwright page instance
 * @param {string} url - Page URL
 * @returns {Promise<{found: boolean, bounds: {x, y, width, height}}>}
 */
async function detectHeaderWithClaude(page, url) {
  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0'
  const enabled = process.env.CLAUDE_CONSENT_ENABLED === 'true'

  if (!enabled) {
    return { found: false, bounds: null }
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return { found: false, bounds: null }
  }

  try {
    // Ensure we're at the top of the page
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    })
    await new Promise(resolve => setTimeout(resolve, 100))

    const client = getBedrockClient()

    // Get viewport dimensions
    const viewport = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      }
    })

    // Capture top 600px of page
    const clipHeight = Math.min(600, viewport.height)
    const screenshot = await takeOptimizedScreenshot(page, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: clipHeight
    })

    // Prepare Claude prompt
    const prompt = `Analyze this webpage screenshot and identify the website header.

The header typically contains:
- Site name or logo
- Navigation menu
- Logo that links to homepage (href="/" or href="/index")

IMPORTANT: If the logo is taller than the main navigation component, also include any breadcrumb navigation element (nav with id containing "breadcrumb" or role="navigation" with breadcrumb class/id) that appears directly below the header. This ensures the full header area is captured without cropping the logo.

Look for the topmost horizontal section that contains these elements. The header is usually at the very top of the page.

Return ONLY a JSON object with the bounding box coordinates:
{
  "x": 0,
  "y": 0,
  "width": ${viewport.width},
  "height": <header height in pixels>
}

If you cannot identify a clear header, return:
{
  "found": false
}

Important: Only return valid JSON, no other text.`

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: screenshot.toString('base64'),
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }

    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    })

    const response = await client.send(command)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    const content = responseBody.content[0].text

    // Parse Claude's response
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { found: false, bounds: null }
      }

      const parsed = JSON.parse(jsonMatch[0])
      
      if (parsed.found === false) {
        return { found: false, bounds: null }
      }

      // Validate bounds (Claude returns viewport-relative coordinates)
      if (parsed.x !== undefined && parsed.y !== undefined && 
          parsed.width !== undefined && parsed.height !== undefined) {
        // After Claude detection, also check for breadcrumb if logo is bigger than nav
        // This post-processing ensures breadcrumb is included when needed
        const enhancedBounds = await page.evaluate((args) => {
          const { claudeBounds, viewportInfo } = args
          const headerRect = {
            x: claudeBounds.x,
            y: claudeBounds.y,
            width: claudeBounds.width,
            height: claudeBounds.height,
            bottom: claudeBounds.y + claudeBounds.height
          }
          
          // Find logo and nav heights to check if compensation is needed
          const logoElements = document.querySelectorAll('img[src*="logo"], img[alt*="logo" i], img[class*="logo" i], a[href="/"] img, a[href="/index"] img')
          let maxLogoHeight = 0
          let mainNavHeight = 0
          
          for (const logo of logoElements) {
            const logoRect = logo.getBoundingClientRect()
            if (logoRect.top >= headerRect.y && logoRect.bottom <= headerRect.bottom && logoRect.height > maxLogoHeight) {
              maxLogoHeight = logoRect.height
            }
          }
          
          const navElements = document.querySelectorAll('nav[role="navigation"]:not([id*="breadcrumb" i]), .main-nav, .top-nav')
          for (const nav of navElements) {
            const navRect = nav.getBoundingClientRect()
            if (navRect.top >= headerRect.y && navRect.bottom <= headerRect.bottom && navRect.height > mainNavHeight) {
              mainNavHeight = navRect.height
            }
          }
          
          const needsBreadcrumbCompensation = maxLogoHeight > mainNavHeight && maxLogoHeight > 0
          
          // Look for breadcrumb elements below header
          const breadcrumbSelectors = [
            'nav[id*="breadcrumb" i]',
            'nav[role="navigation"][id*="breadcrumb" i]',
            '.breadcrumb',
            '[class*="breadcrumb" i]',
            '[id*="breadcrumb" i]'
          ]
          const breadcrumbElements = Array.from(document.querySelectorAll(breadcrumbSelectors.join(', ')))
          let maxBottom = headerRect.bottom
          
          for (const el of breadcrumbElements) {
            const elRect = el.getBoundingClientRect()
            const isBreadcrumb = el.id?.toLowerCase().includes('breadcrumb') || 
                                el.className?.toLowerCase().includes('breadcrumb') ||
                                (el.tagName === 'NAV' && el.getAttribute('role') === 'navigation' && el.id?.toLowerCase().includes('breadcrumb'))
            
            const shouldInclude = (elRect.top >= headerRect.bottom && 
                elRect.top <= headerRect.bottom + 50 && 
                elRect.top < 400 &&
                elRect.left >= headerRect.x - 50 && 
                elRect.right <= headerRect.x + headerRect.width + 50) ||
                (needsBreadcrumbCompensation && isBreadcrumb && 
                 elRect.top >= headerRect.bottom && 
                 elRect.top <= headerRect.bottom + 100 &&
                 elRect.top < 500)
            
            if (shouldInclude) {
              maxBottom = Math.max(maxBottom, elRect.bottom)
            }
          }
          
          return {
            x: headerRect.x,
            y: headerRect.y,
            width: headerRect.width,
            height: Math.max(headerRect.height, maxBottom - headerRect.y)
          }
        }, {
          claudeBounds: {
            x: parsed.x,
            y: parsed.y,
            width: parsed.width,
            height: parsed.height
          },
          viewportInfo: {
            width: viewport.width,
            height: clipHeight
          }
        })
        
        // Ensure bounds are within viewport (viewport-relative coordinates)
        const bounds = {
          x: Math.max(0, Math.min(enhancedBounds.x, viewport.width - 1)),
          y: Math.max(0, Math.min(enhancedBounds.y, clipHeight - 1)),
          width: Math.max(100, Math.min(enhancedBounds.width, viewport.width - enhancedBounds.x)),
          height: Math.max(20, Math.min(enhancedBounds.height, clipHeight - enhancedBounds.y))
        }

        // Final validation
        if (bounds.x < 0 || bounds.y < 0 ||
            bounds.x >= viewport.width ||
            bounds.y >= clipHeight ||
            bounds.width <= 0 || bounds.height <= 0 ||
            bounds.x + bounds.width > viewport.width ||
            bounds.y + bounds.height > clipHeight) {
          return { found: false, bounds: null }
        }

        return { found: true, bounds }
      }

      return { found: false, bounds: null }
    } catch (parseError) {
      console.warn('[Header] Claude response parse error:', parseError.message)
      return { found: false, bounds: null }
    }
  } catch (error) {
    console.warn('[Header] Claude detection error:', error.message)
    return { found: false, bounds: null }
  }
}

/**
 * Capture header screenshot
 * @param {Page} page - Playwright page instance
 * @param {Object} headerBounds - Header bounding box (viewport-relative coordinates)
 * @param {string} device - Device type
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
async function captureHeaderScreenshot(page, headerBounds, device) {
  try {
    // Ensure we're at the top of the page before capturing
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    })
    await new Promise(resolve => setTimeout(resolve, 100))

    // Get viewport dimensions to validate clip bounds
    const viewport = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      }
    })

    // Use original header bounds (not full width) to avoid capturing ads
    // X1 = headerBounds.x (left edge), X2 = headerBounds.x + headerBounds.width (right edge)
    const clip = {
      x: Math.max(0, Math.min(headerBounds.x, viewport.width - 1)), // X1: original left position
      y: Math.max(0, Math.min(headerBounds.y, viewport.height - 1)),
      width: Math.min(headerBounds.width, viewport.width - headerBounds.x), // Original width (not full viewport)
      height: Math.min(headerBounds.height, viewport.height - headerBounds.y)
    }

    // Final validation
    if (clip.width <= 0 || clip.height <= 0 || 
        clip.x < 0 || clip.y < 0 ||
        clip.x + clip.width > viewport.width ||
        clip.y + clip.height > viewport.height) {
      throw new Error(`Invalid clip bounds: ${JSON.stringify(clip)} (viewport: ${viewport.width}x${viewport.height})`)
    }

    // If header height > 400px, find logo and capture thin strip
    if (headerBounds.height > 400) {
      // Find logo image within header
      const logoInfo = await page.evaluate((bounds) => {
        const viewportWidth = window.innerWidth
        const headerRect = {
          left: bounds.x,
          top: bounds.y,
          right: Math.min(bounds.x + bounds.width, viewportWidth),
          bottom: bounds.y + bounds.height
        }

        // Look for logo images
        const images = Array.from(document.querySelectorAll('img'))
        for (const img of images) {
          const rect = img.getBoundingClientRect()
          
          // Check if image is within header bounds (using viewport-relative coordinates)
          if (rect.left >= headerRect.left && 
              rect.right <= headerRect.right &&
              rect.top >= headerRect.top && 
              rect.bottom <= headerRect.bottom &&
              rect.width > 0 && rect.height > 0) {
            
            // Check if it's likely a logo (common patterns)
            const src = img.src || ''
            const alt = img.alt || ''
            const className = img.className || ''
            
            if (src.includes('logo') || 
                alt.toLowerCase().includes('logo') ||
                className.toLowerCase().includes('logo')) {
              return {
                found: true,
                x: Math.max(0, Math.round(rect.left)),
                y: Math.max(0, Math.round(rect.top)),
                width: Math.min(Math.round(rect.width), viewportWidth),
                height: Math.round(rect.height)
              }
            }
          }
        }

        // If no logo found, use top portion of header (first 150px)
        return {
          found: false,
          x: Math.max(0, bounds.x),
          y: Math.max(0, bounds.y),
          width: Math.min(bounds.width, viewportWidth),
          height: Math.min(150, bounds.height)
        }
      }, headerBounds)

      // Use logo info for clip if found, otherwise use top portion
      // Use original header bounds (X1, X2) not full width
      const finalClip = {
        x: Math.max(0, Math.min(headerBounds.x, viewport.width - 1)), // X1: original left position
        y: Math.max(0, Math.min(logoInfo.y, viewport.height - 1)),
        width: Math.min(headerBounds.width, viewport.width - headerBounds.x), // Original width (X2 - X1)
        height: Math.min(logoInfo.height, viewport.height - logoInfo.y)
      }

      // Validate final clip
      if (finalClip.width <= 0 || finalClip.height <= 0 ||
          finalClip.x + finalClip.width > viewport.width ||
          finalClip.y + finalClip.height > viewport.height) {
        // Fallback to full header if logo clip is invalid
        const screenshot = await takeOptimizedScreenshot(page, clip)
        return {
          buffer: screenshot,
          width: clip.width,
          height: clip.height
        }
      }

      const screenshot = await takeOptimizedScreenshot(page, finalClip)
      return {
        buffer: screenshot,
        width: finalClip.width,
        height: finalClip.height
      }
    } else {
      // Capture full header
      const screenshot = await takeOptimizedScreenshot(page, clip)
      return {
        buffer: screenshot,
        width: clip.width,
        height: clip.height
      }
    }
  } catch (error) {
    throw new Error(`Header screenshot capture failed: ${error.message}`)
  }
}

/**
 * Main function to capture header asynchronously
 * @param {Page} page - Playwright page instance
 * @param {string} url - Page URL
 * @param {string} device - Device type
 * @param {string} outputDir - Output directory for header screenshots
 * @returns {Promise<{success: boolean, headerPath: string, headerHeight: number, headerWidth: number} | null>}
 */
export async function captureHeaderAsync(page, url, device, outputDir) {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Try hardcoded detection first
    console.log('[Header] 🔍 Attempting hardcoded pattern detection...')
    let detectionResult = await detectHeaderWithHardcodedPatterns(page, url)

    // If hardcoded fails, try Claude
    if (!detectionResult.found) {
      console.log('[Header] 🤖 Hardcoded detection failed, trying Claude AI...')
      detectionResult = await detectHeaderWithClaude(page, url)
    }

    if (!detectionResult.found || !detectionResult.bounds) {
      console.log('[Header] ⚠️ Header not detected')
      return null
    }

    console.log(`[Header] ✅ Header detected: ${detectionResult.bounds.width}x${detectionResult.bounds.height} at (${detectionResult.bounds.x}, ${detectionResult.bounds.y})`)

    // Capture header screenshot
    const screenshotData = await captureHeaderScreenshot(page, detectionResult.bounds, device)

    // Generate filename: header-{sanitized-url}.png
    const urlObj = new URL(url)
    const sanitizedUrl = urlObj.hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const filename = `header-${sanitizedUrl}.${device === 'macbook-air' ? 'jpg' : 'png'}`
    const filepath = path.join(outputDir, filename)

    // Save screenshot
    fs.writeFileSync(filepath, screenshotData.buffer)

    console.log(`[Header] 💾 Saved header screenshot: ${filename} (${screenshotData.width}x${screenshotData.height})`)

    // Calculate X1 and X2 from original header bounds
    const headerX1 = detectionResult.bounds.x // Left edge
    const headerX2 = detectionResult.bounds.x + detectionResult.bounds.width // Right edge
    
    return {
      success: true,
      headerPath: filepath,
      headerHeight: screenshotData.height,
      headerWidth: screenshotData.width,
      headerX: headerX1, // X1 position for accurate placement
      headerX2: headerX2, // X2 position for accurate placement
      originalWidth: detectionResult.bounds.width, // Original detected width
      originalX: detectionResult.bounds.x // Original X position
    }
  } catch (error) {
    console.warn(`[Header] ❌ Error: ${error.message}`)
    return null
  }
}

