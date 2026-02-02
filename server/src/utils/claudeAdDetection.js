import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getRedisClient } from './redisClient.js'

/**
 * Claude AI Ad Detection
 * 
 * Uses Claude 3.7 Sonnet to visually analyze web pages and identify advertisement elements.
 * Works alongside selector-based detection for comprehensive ad identification.
 */

let bedrockClient = null

// Redis cache configuration for Claude ad detection responses (7-day TTL)
const AI_CACHE_PREFIX = 'ai:ad-detection:'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

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
 * Generate cache key from URL domain
 */
function getCacheKey(url, type = 'ads') {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    return `${AI_CACHE_PREFIX}${type}:${domain}`
  } catch (error) {
    return null
  }
}

/**
 * Get cached response if valid (Redis-based)
 */
async function getCachedResponse(cacheKey) {
  if (!cacheKey) return null
  
  try {
    const redis = getRedisClient()
    const cached = await redis.get(cacheKey)
    
    if (!cached) return null
    
    const data = JSON.parse(cached)
    return data
  } catch (error) {
    // Suppress cache errors in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
      console.error('[Claude Ad] Cache get error:', error)
    }
    return null
  }
}

/**
 * Save response to cache (Redis-based with automatic TTL)
 */
async function setCachedResponse(cacheKey, data) {
  if (!cacheKey) return
  
  try {
    const redis = getRedisClient()
    await redis.setex(
      cacheKey,
      CACHE_TTL_SECONDS,
      JSON.stringify(data)
    )
  } catch (error) {
    // Suppress cache errors in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
      console.error('[Claude Ad] Cache set error:', error)
    }
  }
}

/**
 * Take optimized screenshot (JPEG with PNG fallback)
 */
async function takeOptimizedScreenshot(page) {
  try {
    const screenshot = await page.screenshot({
      fullPage: false,
      type: 'jpeg',
      quality: 85,
    })
    return screenshot
  } catch (error) {
    console.log('[Claude Ad] JPEG screenshot failed, falling back to PNG')
    return await page.screenshot({
      fullPage: false,
      type: 'png',
    })
  }
}

/**
 * Analyze page for ad-related text, dynamic content, and ad blocker patterns
 * 
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzePageForAds(page) {
  return await page.evaluate(() => {
    // 1. Find elements with ad-related text
    const adKeywords = [
      // English
      'advertisement', 'advertise', 'advertising', 'ad', 'ads', 'sponsored', 'promotion',
      // German
      'anzeige', 'anzeigen', 'werbung', 'werbungen', 'beworben',
      // French
      'publicité', 'publicitaires', 'annonce', 'annonces',
      // Spanish
      'anuncio', 'anuncios', 'publicidad',
      // Italian
      'pubblicità', 'annuncio', 'annunci',
      // Other common terms
      'promo', 'promotion', 'sponsor', 'sponsored content'
    ]
    
    const adTextElements = []
    // Use more targeted selectors first for better performance
    const candidateSelectors = [
      // Explicit \"ad\" class plus broader patterns
      'div.ad',
      '*[id*=\"ad\"]', '*[class*=\"ad\"]', '*[id*=\"banner\"]', '*[class*=\"banner\"]',
      '*[id*="werbung"]', '*[class*="werbung"]', '*[id*="anzeige"]', '*[class*="anzeige"]',
      '*[id*="sponsor"]', '*[class*="sponsor"]', 'iframe', 'ins', 'div', 'section', 'aside'
    ]
    
    // Get candidate elements more efficiently
    const candidateElements = new Set()
    candidateSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => candidateElements.add(el))
      } catch (e) {
        // Invalid selector, skip
      }
    })
    
    // Also check all elements if we need comprehensive coverage
    const allElements = Array.from(candidateElements.size > 0 ? candidateElements : document.querySelectorAll('*'))
    
    allElements.forEach(el => {
      const text = (el.textContent || '').toLowerCase().trim()
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()
      const title = (el.getAttribute('title') || '').toLowerCase()
      const id = (el.id || '').toLowerCase()
      // className can be a string or DOMTokenList, convert to string first
      const className = (typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '')).toLowerCase()
      
      const allText = `${text} ${ariaLabel} ${title} ${id} ${className}`
      
      // Check if element contains ad-related keywords
      const hasAdKeyword = adKeywords.some(keyword => allText.includes(keyword))
      
      if (hasAdKeyword) {
        // Find the parent container that likely contains the full ad
        let adContainer = el
        let containerRect = el.getBoundingClientRect()
        
        // Look for parent containers that might be the full ad frame
        // Check up to 5 levels up the DOM tree
        let parent = el.parentElement
        let levelsChecked = 0
        const maxLevels = 5
        
        while (parent && levelsChecked < maxLevels) {
          const parentRect = parent.getBoundingClientRect()
          const parentId = (parent.id || '').toLowerCase()
          const parentClassName = (typeof parent.className === 'string' ? parent.className : (parent.className?.baseVal || parent.className?.toString() || '')).toLowerCase()
          
          // Check if parent looks like an ad container
          const parentLooksLikeAdContainer = 
            parentId.includes('ad') || parentId.includes('banner') || parentId.includes('werbung') || parentId.includes('anzeige') ||
            parentClassName.includes('ad') || parentClassName.includes('banner') || parentClassName.includes('werbung') || parentClassName.includes('anzeige') ||
            parent.tagName === 'IFRAME' || parent.tagName === 'INS' ||
            (parentRect.width >= 100 && parentRect.height >= 50) // Reasonable ad size
          
          if (parentLooksLikeAdContainer && parentRect.width >= 20 && parentRect.height >= 20) {
            adContainer = parent
            containerRect = parentRect
            break
          }
          
          parent = parent.parentElement
          levelsChecked++
        }
        
        // Use the container's dimensions if it's larger and looks like an ad
        const finalRect = containerRect.width >= 100 && containerRect.height >= 50 ? containerRect : el.getBoundingClientRect()
        
        if (finalRect.width >= 20 && finalRect.height >= 20) {
          const matchedKeyword = adKeywords.find(k => allText.includes(k))
          
          // Check if we already have a similar ad (avoid duplicates)
          const isDuplicate = adTextElements.some(existing => {
            const xDiff = Math.abs(existing.position.x - Math.round(finalRect.left + window.pageXOffset))
            const yDiff = Math.abs(existing.position.y - Math.round(finalRect.top + window.pageYOffset))
            // If within 50px, consider it a duplicate
            return xDiff < 50 && yDiff < 50
          })
          
          if (!isDuplicate) {
            adTextElements.push({
              text: text.substring(0, 100), // First 100 chars
              keyword: matchedKeyword, // Which keyword matched
              position: {
                x: Math.round(finalRect.left + window.pageXOffset),
                y: Math.round(finalRect.top + window.pageYOffset)
              },
              size: {
                width: Math.round(finalRect.width),
                height: Math.round(finalRect.height)
              },
              tagName: adContainer.tagName,
              id: adContainer.id,
              className: typeof adContainer.className === 'string' ? adContainer.className : (adContainer.className?.baseVal || adContainer.className?.toString() || ''),
              isContainer: adContainer !== el // Whether we found a parent container
            })
          }
        }
      }
    })
    
    // Sort by position (top to bottom, left to right) for better organization
    adTextElements.sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y
      return a.position.x - b.position.x
    })
    
    // 2. Find dynamic/rapidly updating elements (ads typically update frequently)
    const dynamicElements = []
    const iframes = Array.from(document.querySelectorAll('iframe'))
    const scripts = Array.from(document.querySelectorAll('script[src]'))
    
    // Check iframe sources for ad networks
    const adNetworkPatterns = [
      'doubleclick', 'googlesyndication', 'googleads', 'adservice',
      'adform', 'adition', 'criteo', 'pubmatic', 'openx', 'rubicon',
      'adsrvr', 'quantserve', 'yieldlab', 'stroeer', 'mediasmart',
      'smartadserver', 'taboola', 'outbrain', '/ads/', '/ad/',
      'adsystem', 'adserver', 'advertising', 'adtech'
    ]
    
    iframes.forEach(iframe => {
      const src = (iframe.src || '').toLowerCase()
      const id = (iframe.id || '').toLowerCase()
      // className can be a string or DOMTokenList, convert to string first
      const className = (typeof iframe.className === 'string' ? iframe.className : (iframe.className?.baseVal || iframe.className?.toString() || '')).toLowerCase()
      
      const isAdNetwork = adNetworkPatterns.some(pattern => 
        src.includes(pattern) || id.includes(pattern) || className.includes(pattern)
      )
      
      if (isAdNetwork) {
        const rect = iframe.getBoundingClientRect()
        if (rect.width >= 20 && rect.height >= 20) {
          dynamicElements.push({
            type: 'iframe',
            src: iframe.src,
            position: {
              x: Math.round(rect.left + window.pageXOffset),
              y: Math.round(rect.top + window.pageYOffset)
            },
            size: {
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          })
        }
      }
    })
    
    // 3. Ad blocker patterns (common selectors ad blockers use)
    const adBlockerSelectors = [
      // Common ad container patterns
      'div.ad',
      '[id*=\"ad\"]', '[class*=\"ad\"]', '[id*=\"advertisement\"]', '[class*=\"advertisement\"]',
      '[id*=\"banner\"]', '[class*=\"banner\"]', '[id*=\"sponsor\"]', '[class*=\"sponsor\"]',
      '[id*=\"promo\"]', '[class*=\"promo\"]', '[id*=\"advert\"]', '[class*=\"advert\"]',
      // German patterns
      '[id*="anzeige"]', '[class*="anzeige"]', '[id*="werbung"]', '[class*="werbung"]',
      // Common ad sizes
      '[id*="300x250"]', '[id*="728x90"]', '[id*="160x600"]', '[id*="320x50"]',
      // Ad network specific
      '[id*="google_ads"]', '[class*="google_ads"]', '[id*="adsense"]', '[class*="adsense"]',
      '[id*="doubleclick"]', '[class*="doubleclick"]'
    ]
    
    const adBlockerElements = []
    adBlockerSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector)
        elements.forEach(el => {
          const rect = el.getBoundingClientRect()
          if (rect.width >= 20 && rect.height >= 20) {
            // Check if not already added
            const alreadyAdded = adBlockerElements.some(existing => 
              existing.position.x === Math.round(rect.left + window.pageXOffset) &&
              existing.position.y === Math.round(rect.top + window.pageYOffset)
            )
            
            if (!alreadyAdded) {
              adBlockerElements.push({
                selector: selector,
                position: {
                  x: Math.round(rect.left + window.pageXOffset),
                  y: Math.round(rect.top + window.pageYOffset)
                },
                size: {
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                },
                id: el.id,
                className: typeof el.className === 'string' ? el.className : (el.className?.baseVal || el.className?.toString() || '')
              })
            }
          }
        })
      } catch (e) {
        // Invalid selector, skip
      }
    })
    
      return {
        adTextElements: adTextElements, // Return all found (no limit - Claude needs to see all)
        dynamicElements: dynamicElements.slice(0, 20),
        adBlockerElements: adBlockerElements.slice(0, 30)
      }
  })
}

/**
 * Detect advertisements using Claude AI vision
 * 
 * @param {Page} page - Playwright page instance
 * @param {Object} options - Configuration options
 * @param {number} options.maxAttempts - Maximum attempts (default: 1)
 * @returns {Promise<Array>} - Array of detected ad bounding boxes: [{x, y, width, height, confidence}]
 */
export async function detectAdsWithClaude(page, options = {}) {
  const {
    maxAttempts = 1,
  } = options

  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0'
  const enabled = process.env.CLAUDE_CONSENT_ENABLED === 'true' // Reuse consent enabled flag

  if (!enabled) {
    console.log('[Claude Ad] AI ad detection is disabled (set CLAUDE_CONSENT_ENABLED=true)')
    return []
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('[Claude Ad] AWS credentials not configured')
    return []
  }

  console.log('[Claude Ad] ✅ Starting AI ad detection...')

  // Check cache first
  const pageUrl = page.url()
  const cacheKey = getCacheKey(pageUrl, 'ads')
  const cachedResult = await getCachedResponse(cacheKey)
  
  if (cachedResult && cachedResult.ads && cachedResult.ads.length > 0) {
    console.log(`[Claude Ad] ✅ Found ${cachedResult.ads.length} ads (cached)`)
    return cachedResult.ads
  }

  try {
    const client = getBedrockClient()

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Analyze page for ad indicators (text, dynamic content, ad blocker patterns)
      console.log('[Claude Ad] 🔍 Analyzing page for ad indicators (text, dynamic content, ad blocker patterns)...')
      const pageAnalysis = await analyzePageForAds(page)
      
      const hasAdIndicators = pageAnalysis.adTextElements.length > 0 || 
                              pageAnalysis.dynamicElements.length > 0 || 
                              pageAnalysis.adBlockerElements.length > 0
      
      console.log(`[Claude Ad] 📊 Analysis results: ${pageAnalysis.adTextElements.length} text elements, ${pageAnalysis.dynamicElements.length} dynamic elements, ${pageAnalysis.adBlockerElements.length} ad blocker matches`)
      
      // Only proceed with Claude if we have actual ad indicators
      if (!hasAdIndicators) {
        console.log('[Claude Ad] ⚠️ No ad indicators found (keywords, network patterns, or ad blocker patterns). Skipping Claude detection to avoid random selections.')
        return []
      }
      
      console.log('[Claude Ad] ✅ Ad indicators found. Proceeding with Claude detection...')
      
      // Take screenshot
      const screenshot = await takeOptimizedScreenshot(page)

      // Get viewport dimensions for coordinate normalization
      const viewport = await page.evaluate(() => {
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollWidth: Math.max(
            document.body.scrollWidth,
            document.documentElement.scrollWidth
          ),
          scrollHeight: Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
          )
        }
      })
      
      // Build analysis summary for Claude (only include actual findings)
      const analysisSummary = []
      if (pageAnalysis.adTextElements.length > 0) {
        analysisSummary.push(`Found ${pageAnalysis.adTextElements.length} elements with ad-related text (e.g., "Advertisement", "Anzeige", "Werbung")`)
      }
      if (pageAnalysis.dynamicElements.length > 0) {
        analysisSummary.push(`Found ${pageAnalysis.dynamicElements.length} dynamic iframes/elements from ad networks`)
      }
      if (pageAnalysis.adBlockerElements.length > 0) {
        analysisSummary.push(`Found ${pageAnalysis.adBlockerElements.length} elements matching ad blocker patterns`)
      }
      
      // If no indicators found, we shouldn't reach here, but double-check
      if (analysisSummary.length === 0) {
        console.log('[Claude Ad] ⚠️ No ad indicators to analyze. Skipping Claude detection.')
        return []
      }

      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
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
                text: `Analyze this webpage screenshot and identify ONLY advertisement elements that correspond to the ad indicators found in the page analysis.

IMPORTANT CONTEXT FROM PAGE ANALYSIS:
${analysisSummary.join('\n')}

CRITICAL: Only identify ads that are related to the indicators above. Do NOT identify random elements or content that doesn't match these indicators.

${pageAnalysis.adTextElements.length > 0 ? `
ELEMENTS WITH AD-RELATED TEXT FOUND (${pageAnalysis.adTextElements.length} total - detect ALL of them):
${pageAnalysis.adTextElements.map((el, i) => 
  `${i + 1}. Keyword: "${el.keyword || 'unknown'}", Text: "${el.text.substring(0, 50)}..." at position (${el.position.x}, ${el.position.y}), size ${el.size.width}x${el.size.height}${el.isContainer ? ' [FULL AD CONTAINER]' : ' [TEXT ONLY - find parent container]'}`
).join('\n')}

CRITICAL INSTRUCTIONS FOR TEXT-BASED DETECTION:
1. Each "Werbung", "Anzeige", or "Advertisement" text indicates a SEPARATE ad - detect ALL of them
2. When you see ad-related text, identify the COMPLETE ad container/frame that contains it:
   - Look for light grey backgrounds, rectangular frames, or bordered boxes around the text
   - The ad container is usually MUCH LARGER than just the text label
   - Capture the full rectangular area including any background, borders, or frames
3. Multiple "Werbung" labels = multiple separate ad containers (each needs its own AD_BOX)
4. If text is small but container is large, use the container's dimensions
5. Look for visual boundaries: borders, background color changes, or clear rectangular divisions
` : ''}

${pageAnalysis.dynamicElements.length > 0 ? `
DYNAMIC AD NETWORK IFRAMES FOUND:
${pageAnalysis.dynamicElements.slice(0, 10).map((el, i) => 
  `${i + 1}. ${el.type} at position (${el.position.x}, ${el.position.y}), size ${el.size.width}x${el.size.height}, src: ${el.src ? el.src.substring(0, 60) : 'none'}`
).join('\n')}
` : ''}

${pageAnalysis.adBlockerElements.length > 0 ? `
ELEMENTS MATCHING AD BLOCKER PATTERNS:
${pageAnalysis.adBlockerElements.slice(0, 10).map((el, i) => 
  `${i + 1}. Matched selector "${el.selector}" at position (${el.position.x}, ${el.position.y}), size ${el.size.width}x${el.size.height}`
).join('\n')}
` : ''}

DETECTION PRIORITIES (ONLY detect ads related to the indicators found above):

1. **Text-based detection** (ONLY if ad-related text was found in analysis): 
   - Focus ONLY on the specific ad-related text elements listed above
   - For each text element mentioned, identify the COMPLETE ad container/frame that contains it
   - Look for light grey backgrounds, rectangular frames, or bordered boxes around the text
   - The ad container is usually larger than just the text - capture the full rectangular area
   - DO NOT identify ads that don't have ad-related text visible

2. **Dynamic content detection** (ONLY if dynamic ad network elements were found):
   - Focus ONLY on the iframes/elements from ad networks listed above
   - Identify the visual ad containers that correspond to these network elements
   - DO NOT identify random iframes that aren't from known ad networks

3. **Ad blocker patterns** (ONLY if ad blocker pattern matches were found):
   - Focus ONLY on the elements matching ad blocker patterns listed above
   - Identify the visual ad containers that correspond to these pattern matches
   - DO NOT identify random elements that don't match known ad patterns

IMPORTANT: Do NOT use general visual patterns or guesswork. ONLY identify ads that directly correspond to the specific indicators found in the page analysis.

CRITICAL - DO NOT identify:
- Navigation menus
- Site headers/footers (unless they contain ads matching the indicators)
- Content images (unless they match the ad indicators found)
- Social media widgets (unless they match the ad indicators)
- Cookie consent banners (those are handled separately)
- Newsletter signup forms
- Site logos or branding
- Regular content sections
- Article content blocks (even if they have images)
- Text content that is NOT part of an ad container
- ANY element that doesn't correspond to the ad indicators found in the page analysis
- Random elements just because they look like they could be ads - ONLY identify if they match the indicators

CRITICAL FRAME DETECTION RULES:
1. **ONLY identify COMPLETE ad containers/frames** - NOT partial elements, text labels, or nested components
2. **Look for visual boundaries**: Complete rectangular areas with:
   - Distinct backgrounds (light grey, white, colored boxes)
   - Clear borders or frames around the ad
   - Complete ad content within a single container
3. **DO NOT identify**:
   - Just the text label "Werbung" or "Advertisement" alone - identify the FULL container that contains it
   - Small nested elements inside ads - identify the PARENT container
   - Partial areas that don't form a complete rectangular frame
   - Text that is misaligned or not part of a complete ad frame
4. **Frame validation**:
   - Each AD_BOX must represent a COMPLETE, standalone ad container
   - The frame should have clear visual boundaries
   - The frame should contain the full ad content, not just a portion
   - If unsure whether something is a complete frame, DO NOT include it

For each COMPLETE advertisement container/frame you find, provide the bounding box coordinates in this exact format:
AD_BOX: x,y,width,height

Where:
- x, y = top-left corner coordinates (in pixels from top-left of viewport)
- width, height = dimensions of the COMPLETE ad container/frame (in pixels)
- Each AD_BOX must represent a FULL, COMPLETE ad container - not partial elements

Example response:
AD_BOX: 0,0,728,90
AD_BOX: 300,500,300,250
AD_BOX: 1440,0,160,600

If no ads are visible, respond with: NO_ADS

Viewport dimensions: ${viewport.width}x${viewport.height}
Page dimensions: ${viewport.scrollWidth}x${viewport.scrollHeight}`,
              },
            ],
          },
        ],
      }

      // Call Bedrock with Claude model
      const command = new InvokeModelCommand({
        modelId: modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      })

      const response = await client.send(command)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))

      // Parse Claude's response
      if (responseBody.content && responseBody.content.length > 0) {
        const textBlock = responseBody.content.find(block => block.type === 'text')
        
        if (textBlock && textBlock.text) {
          const responseText = textBlock.text.trim()

          // Check if no ads found
          if (responseText.includes('NO_ADS')) {
            console.log('[Claude Ad] No ads detected')
            await setCachedResponse(cacheKey, { ads: [] })
            return []
          }

          // Extract all AD_BOX coordinates
          const adBoxRegex = /AD_BOX:\s*(\d+),(\d+),(\d+),(\d+)/gi
          const matches = [...responseText.matchAll(adBoxRegex)]
          
          if (matches.length > 0) {
            const ads = matches
              .map(match => {
                const x = parseInt(match[1], 10)
                const y = parseInt(match[2], 10)
                const width = parseInt(match[3], 10)
                const height = parseInt(match[4], 10)
                
                // Validate coordinates are reasonable
                if (x < 0 || y < 0 || width <= 0 || height <= 0) {
                  return null // Invalid coordinates
                }
                
                // Validate coordinates are within reasonable bounds (strict - small 50px margin)
                // Check both top-left corner and bottom-right corner
                const adBottom = y + height
                const adRight = x + width
                if (x < -50 || y < -50 || // Top-left corner must be within bounds (small margin for rounding)
                    adRight > viewport.scrollWidth + 50 || // Right edge must be within content
                    adBottom > viewport.scrollHeight + 50) { // Bottom edge must be within content
                  return null // Way off screen or beyond content
                }
                
                // Validate size is reasonable (not too large)
                if (width > 10000 || height > 10000) {
                  return null // Unreasonably large
                }
                
                return {
                  x,
                  y,
                  width,
                  height,
                  confidence: 'high', // Claude detection is high confidence
                  source: 'claude-ai'
                }
              })
              .filter(ad => ad !== null) // Remove invalid ads

            console.log(`[Claude Ad] ✅ Detected ${ads.length} ads`)
            
            // Cache successful detection
            await setCachedResponse(cacheKey, { ads })
            
            return ads
          }
        }
      }

      // If we get here, Claude didn't provide actionable response
      if (attempt < maxAttempts) {
        await page.waitForTimeout(1000)
      }
    }

    console.log('[Claude Ad] ⚠️ No ads detected or invalid response')
    await setCachedResponse(cacheKey, { ads: [] })
    return []

  } catch (error) {
    console.error('[Claude Ad] ❌ Error during ad detection:', error.message)
    return []
  }
}

