import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getRedisClient } from './redisClient.js'

/**
 * Claude Computer Use - AI-powered consent button detection via AWS Bedrock
 * 
 * Uses Claude 3.7 Sonnet to visually analyze web pages and intelligently
 * identify and click cookie consent buttons in any language.
 * 
 * Performance Optimizations:
 * - Regional optimization: EU-Central-1 for lower latency
 * - Response caching: 7-day TTL for consent patterns per domain (Redis)
 * - JPEG compression: Reduced upload time with PNG fallback
 */

let bedrockClient = null

// Redis cache configuration for Claude responses (7-day TTL)
const AI_CACHE_PREFIX = 'ai:consent:'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

// Initialize AWS Bedrock client (optimized for EU region)
function getBedrockClient() {
  if (bedrockClient) return bedrockClient

  const config = {
    region: process.env.AWS_BEDROCK_REGION || 'eu-central-1', // ✅ Regional optimization
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
 * @param {string} url - Page URL
 * @param {string} type - Cache type ('consent' or 'popup')
 * @returns {string} Cache key
 */
function getCacheKey(url, type = 'consent') {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    return `${AI_CACHE_PREFIX}${type}:${domain}`
  } catch (error) {
    return null
  }
}

/**
 * Get cached response if valid (Redis-based)
 * @param {string} cacheKey - Cache key
 * @returns {Promise<Object|null>} Cached response or null
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
    console.error('[Claude] Cache get error:', error)
    }
    return null
  }
}

/**
 * Save response to cache (Redis-based with automatic TTL)
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Data to cache
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
    // Pattern cached silently
  } catch (error) {
    // Suppress cache errors in test mode
    if (process.env.SUPPRESS_REDIS_ERRORS !== 'true') {
    console.error('[Claude] Cache set error:', error)
    }
  }
}

/**
 * Take optimized screenshot (JPEG with PNG fallback)
 * @param {Page} page - Playwright page instance
 * @returns {Promise<Buffer>} Screenshot buffer
 */
async function takeOptimizedScreenshot(page) {
  try {
    // Try JPEG first for better performance (5-10x smaller)
    const screenshot = await page.screenshot({
      fullPage: false,
      type: 'jpeg',
      quality: 85, // Good balance of quality vs size
    })
    return screenshot
  } catch (error) {
    // Fallback to PNG if JPEG fails (100% safe)
    console.log('[Claude] JPEG screenshot failed, falling back to PNG')
    return await page.screenshot({
      fullPage: false,
      type: 'png',
    })
  }
}

/**
 * Find and click cookie consent button using Claude's vision capabilities via AWS Bedrock
 * 
 * @param {Page} page - Playwright page instance
 * @param {Object} options - Configuration options
 * @param {number} options.maxAttempts - Maximum attempts to find button (default: 2)
 * @param {boolean} options.takeScreenshotAfter - Whether to take screenshot after clicking (default: true)
 * @returns {Promise<boolean>} - True if button was found and clicked, false otherwise
 */
export async function findAndClickConsentWithClaude(page, options = {}) {
  const {
    maxAttempts = 2,
    takeScreenshotAfter = true,
  } = options

  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0'
  const enabled = process.env.CLAUDE_CONSENT_ENABLED === 'true'

  if (!enabled) {
    console.log('[Claude] AI consent detection is disabled (set CLAUDE_CONSENT_ENABLED=true)')
    return false
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('[Claude] AWS credentials not configured')
    return false
  }

  console.log('[Claude] ✅ Working - Starting consent detection...')

  // ✅ Check cache first (2-5 second speedup)
  const pageUrl = page.url()
  const cacheKey = getCacheKey(pageUrl, 'consent')
  const cachedResult = await getCachedResponse(cacheKey)
  
  if (cachedResult && cachedResult.buttonText) {
    const clicked = await tryClickButton(page, cachedResult.buttonText)
    if (clicked) {
      console.log(`[Claude] ✅ Completed - Clicked consent button: "${cachedResult.buttonText}" (cached)`)
      await page.waitForTimeout(2000)
      return true
    }
  }

  try {
    const client = getBedrockClient()
    const consentStartTime = Date.now() // Track total time for consent detection

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now()

      // ✅ Take optimized screenshot (JPEG with PNG fallback)
      const screenshotStart = Date.now()
      const screenshot = await takeOptimizedScreenshot(page)
      const screenshotTime = Date.now() - screenshotStart
      console.log(`[Claude] ⏱️ Screenshot taken: ${screenshotTime}ms`)

      // Prepare the request for Claude vision (without Computer Use tool)
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg', // ✅ Updated for JPEG (works with PNG too)
                  data: screenshot.toString('base64'),
                },
              },
              {
                type: 'text',
                text: `Analyze this webpage screenshot and identify if there is a cookie consent popup visible.

Look for buttons with text like:
- English: "Accept", "Accept All", "Agree", "Allow All", "Continue", "OK", "I Agree"
- German: "Akzeptieren", "Alle akzeptieren", "Zustimmen", "Einverstanden", "Einwilligen und weiter"
- French: "Accepter", "Accepter tout", "J'accepte"
- Spanish: "Aceptar", "Aceptar todo"
- Italian: "Accetta", "Accetta tutto"
- Dutch: "Accepteren", "Alles accepteren"

IMPORTANT: If multiple buttons exist, identify the one that accepts ALL cookies (NOT "Reject", "Settings", "Customize", or similar).

Respond in this exact format:
- If you find a consent accept button, respond with: BUTTON_TEXT: <exact text on the button>
- If no consent button is visible, respond with: NO_CONSENT

Examples:
- BUTTON_TEXT: Einwilligen und weiter
- BUTTON_TEXT: Accept All Cookies
- NO_CONSENT`,
              },
            ],
          },
        ],
      }

      // Call Bedrock with Claude model
      const bedrockStart = Date.now()
      const command = new InvokeModelCommand({
        modelId: modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      })

      const response = await client.send(command)
      const bedrockTime = Date.now() - bedrockStart
      console.log(`[Claude] ⏱️ Bedrock API call: ${bedrockTime}ms`)
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))

      // Parse Claude's response
      if (responseBody.content && responseBody.content.length > 0) {
        const textBlock = responseBody.content.find(block => block.type === 'text')
        
        if (textBlock && textBlock.text) {
          const responseText = textBlock.text.trim()

          // Check if no consent button found (silent - no log needed)
          if (responseText.includes('NO_CONSENT')) {
            return false
          }

          // Extract button text
          const buttonTextMatch = responseText.match(/BUTTON_TEXT:\s*(.+?)(?:\n|$)/i)
          if (buttonTextMatch) {
            const buttonText = buttonTextMatch[1].trim()
            console.log(`[Claude] ✅ Working - Identified consent button: "${buttonText}"`)

            // Try to click the button using Playwright
            const clickStart = Date.now()
            const clicked = await tryClickButton(page, buttonText)
            const clickTime = Date.now() - clickStart
            
            if (clicked) {
              const attemptTime = Date.now() - attemptStart
              const totalTime = Date.now() - consentStartTime
              console.log(`[Claude] ✅ Completed - Clicked consent button: "${buttonText}" - Attempt: ${attemptTime}ms, Total: ${totalTime}ms (screenshot: ${screenshotTime}ms, bedrock: ${bedrockTime}ms, click: ${clickTime}ms)`)
              
              // ✅ Cache successful button pattern (7-day TTL)
              const cacheSaveStart = Date.now()
              await setCachedResponse(cacheKey, { buttonText })
              const cacheSaveTime = Date.now() - cacheSaveStart
              console.log(`[Claude] ⏱️ Cache saved: ${cacheSaveTime}ms`)
              
              // Wait for page to settle after click
              await page.waitForTimeout(2000)

              if (takeScreenshotAfter) {
                await page.waitForTimeout(1000)
              }

              return true
            } else {
              const attemptTime = Date.now() - attemptStart
              console.log(`[Claude] ⚠️ Button identified but click failed - Attempt: ${attemptTime}ms`)
            }
          } else {
            const attemptTime = Date.now() - attemptStart
            console.log(`[Claude] ⚠️ No button text found in response - Attempt: ${attemptTime}ms`)
          }
        }
      }

      // If we get here, Claude didn't provide actionable response
      const attemptTime = Date.now() - attemptStart
      console.log(`[Claude] ⚠️ Attempt ${attempt} completed without success - Time: ${attemptTime}ms`)
      if (attempt < maxAttempts) {
        await page.waitForTimeout(1000)
      }
    }
    
    const totalTime = Date.now() - consentStartTime
    console.log(`[Claude] ⏱️ Total consent detection time: ${totalTime}ms (all attempts failed)`)

    return false

  } catch (error) {
    // Full error details for debugging
    console.error('[Claude] ❌ ERROR in consent detection:', {
      file: 'claudeConsent.js',
      function: 'findAndClickConsentWithClaude',
      error: error.message,
      stack: error.stack,
      url: options?.url || 'unknown'
    })
    return false
  }
}

/**
 * Try to click a button by its text using multiple strategies
 * 
 * @param {Page} page - Playwright page instance
 * @param {string} buttonText - The text on the button to click
 * @returns {Promise<boolean>} - True if button was clicked, false otherwise
 */
async function tryClickButton(page, buttonText) {
  const buttonClickStart = Date.now()
  const MAX_BUTTON_CLICK_TIME = 30000 // 30 seconds max for entire button click operation
  
  try {
    // PHASE 1: Search in main page frame (with timeout)
    try {
      const mainFrameResult = await Promise.race([
        tryClickInFrame(page, buttonText, 'Main Frame'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Main frame click timeout')), 10000))
      ])
    if (mainFrameResult) return true
    } catch (mainFrameError) {
      // Continue to iframe search even if main frame times out
    }
    
    // Check if we've exceeded max time
    if (Date.now() - buttonClickStart > MAX_BUTTON_CLICK_TIME) {
      console.warn(`[Claude] ⚠️ Button click operation exceeded ${MAX_BUTTON_CLICK_TIME}ms, aborting`)
      return false
    }
    
    // PHASE 2: Search in all iframes (prioritize consent-related iframes)
    const frames = page.frames()
    if (frames.length > 1) {
      // Separate frames into consent-related, ad-related, and others
      const consentFrames = []
      const otherFrames = []
      
      // ⚠️ CRITICAL: Ad-related keywords to SKIP (NEVER interact with ad iframes)
      const adKeywords = [
        'google_ads', 'googleads', 'googlesyndication', 'doubleclick',
        'adservice', 'advertising', 'adform', 'adition', 'criteo',
        'pubmatic', 'openx', 'rubiconproject', 'adsrvr', 'quantserve',
        'yieldlab', 'stroeer', 'mediasmart', 'smartadserver',
        '/ads/', '/ad/', 'taboola', 'outbrain'
      ]
      
      for (let i = 1; i < frames.length; i++) {
        // Check timeout before processing each iframe
        if (Date.now() - buttonClickStart > MAX_BUTTON_CLICK_TIME) {
          console.warn(`[Claude] ⚠️ Button click operation exceeded ${MAX_BUTTON_CLICK_TIME}ms during iframe processing, aborting`)
          return false
        }
        
        const frame = frames[i]
        const frameUrl = frame.url().toLowerCase()
        
        // ⚠️ SKIP ad iframes completely
        const isAdFrame = adKeywords.some(keyword => frameUrl.includes(keyword))
        if (isAdFrame) {
          continue // Skip to next iframe
        }
        
        // Check if this iframe might be a consent iframe (common patterns)
        const consentKeywords = ['consent', 'cookie', 'privacy', 'cmp', 'quantcast', 
                                  'onetrust', 'cookiebot', 'trustarc', 'didomi', 'usercentrics']
        const isLikelyConsentFrame = consentKeywords.some(keyword => frameUrl.includes(keyword))
        
        if (isLikelyConsentFrame) {
          consentFrames.push({ frame, index: i })
        } else {
          otherFrames.push({ frame, index: i })
        }
      }
      
      // Check consent frames first (higher probability) - limit to first 5 to prevent timeout
      if (consentFrames.length > 0) {
        for (const { frame, index } of consentFrames.slice(0, 5)) {
          if (Date.now() - buttonClickStart > MAX_BUTTON_CLICK_TIME) {
            console.warn(`[Claude] ⚠️ Button click operation exceeded ${MAX_BUTTON_CLICK_TIME}ms, aborting`)
            return false
          }
          
          try {
            const iframeResult = await Promise.race([
              tryClickInFrame(frame, buttonText, `Consent Iframe ${index}`),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Iframe click timeout')), 5000))
            ])
          if (iframeResult) return true
          } catch (iframeError) {
            // Continue to next iframe if this one times out
            continue
          }
        }
      }
      
      // Then check other frames - limit to first 3 to prevent timeout
      if (otherFrames.length > 0) {
        for (const { frame, index } of otherFrames.slice(0, 3)) {
          if (Date.now() - buttonClickStart > MAX_BUTTON_CLICK_TIME) {
            console.warn(`[Claude] ⚠️ Button click operation exceeded ${MAX_BUTTON_CLICK_TIME}ms, aborting`)
            return false
          }
          
          try {
            const iframeResult = await Promise.race([
              tryClickInFrame(frame, buttonText, `Iframe ${index}`),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Iframe click timeout')), 5000))
            ])
          if (iframeResult) return true
          } catch (iframeError) {
            // Continue to next iframe if this one times out
            continue
          }
        }
      }
    }

    return false

  } catch (error) {
    console.error('[Claude] ❌ ERROR clicking button:', {
      file: 'claudeConsent.js',
      function: 'tryClickButton',
      error: error.message,
      stack: error.stack,
      buttonText
    })
    return false
  }
}

/**
 * Try to click button in a specific frame using multiple strategies
 * 
 * @param {Frame|Page} frame - Playwright frame or page instance
 * @param {string} buttonText - The text on the button to click
 * @param {string} frameLabel - Label for logging (e.g., "Main Frame", "Iframe 1")
 * @returns {Promise<boolean>} - True if button was clicked, false otherwise
 */
async function tryClickInFrame(frame, buttonText, frameLabel) {
  try {
    // Helper to add timeout to count operations
    const countWithTimeout = async (locator, timeout = 3000) => {
      return Promise.race([
        locator.count(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Count timeout')), timeout))
      ]).catch(() => 0)
    }

    // Strategy 1: Try exact text match with button role
    const exactButton = frame.getByRole('button', { name: buttonText, exact: true })
    if (await countWithTimeout(exactButton, 3000) > 0) {
      await exactButton.first().click({ timeout: 5000 })
      return true
    }

    // Strategy 2: Try partial text match with button role
    const partialButton = frame.getByRole('button', { name: new RegExp(buttonText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    if (await countWithTimeout(partialButton, 3000) > 0) {
      await partialButton.first().click({ timeout: 5000 })
      return true
    }

    // Strategy 3: Try text selector
    const textSelector = frame.locator(`text="${buttonText}"`)
    if (await countWithTimeout(textSelector, 3000) > 0) {
      await textSelector.first().click({ timeout: 5000 })
      return true
    }

    // Strategy 4: Try contains text
    const containsSelector = frame.locator(`:has-text("${buttonText}")`)
    if (await countWithTimeout(containsSelector, 3000) > 0) {
      await containsSelector.first().click({ timeout: 5000 })
      return true
    }

    // Strategy 5: Try getByText
    const getByText = frame.getByText(buttonText, { exact: false })
    if (await countWithTimeout(getByText, 3000) > 0) {
      await getByText.first().click({ timeout: 5000 })
      return true
    }

    // Strategy 6: Try shadow DOM piercing (Playwright 1.28+)
    try {
      // Use the :nth-match and pierce selectors for shadow DOM
        const shadowButton = frame.locator(`button:has-text("${buttonText}")`)
        const shadowCount = await countWithTimeout(shadowButton, 3000)
        
        if (shadowCount > 0) {
        await shadowButton.first().click({ timeout: 5000 })
        return true
      }
      
      // Also try with div[role="button"] in shadow DOM
      const shadowDivButton = frame.locator(`div[role="button"]:has-text("${buttonText}")`)
      if (await countWithTimeout(shadowDivButton, 3000) > 0) {
        await shadowDivButton.first().click({ timeout: 5000 })
        return true
      }
    } catch (shadowError) {
      // Silent fail for shadow DOM
    }

    // Strategy 7: Try manual evaluation for deeply nested Shadow DOM (with timeout)
    try {
      const shadowDOMResult = await Promise.race([
        frame.evaluate((text) => {
        // Recursive function to search through shadow DOMs
        function findInShadowDOM(root, searchText) {
          // Check current root
          const elements = root.querySelectorAll('*')
          for (const el of elements) {
            if (el.textContent && el.textContent.includes(searchText)) {
              // Check if it's clickable (button or has click handler)
              if (el.tagName === 'BUTTON' || 
                  el.getAttribute('role') === 'button' ||
                  el.onclick !== null) {
                return {
                  found: true,
                  selector: null, // Can't return selector from inside Shadow DOM
                  outerHTML: el.outerHTML.substring(0, 200)
                }
              }
            }
            
            // Recursively search in shadow roots
            if (el.shadowRoot) {
              const result = findInShadowDOM(el.shadowRoot, searchText)
              if (result.found) return result
            }
          }
          return { found: false }
        }
        
        return findInShadowDOM(document, text)
      }, buttonText),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Shadow DOM evaluation timeout')), 5000))
      ])
      
      if (shadowDOMResult && shadowDOMResult.found) {
        // Found but can't click - silent fail
      }
    } catch (deepShadowError) {
      // Silent fail for deep shadow search (including timeout)
    }

    return false

  } catch (error) {
    console.error('[Claude] ❌ ERROR in tryClickInFrame:', {
      file: 'claudeConsent.js',
      function: 'tryClickInFrame',
      frameLabel,
      buttonText,
      error: error.message,
      stack: error.stack
    })
    return false
  }
}

/**
 * Log page structure for debugging - REMOVED (too verbose)
 * 
 * @param {Page} page - Playwright page instance
 * @param {string} searchText - The text we're looking for
 */
async function logPageStructure(page, searchText) {
  // Function disabled - too verbose, only errors are logged now
  return
  try {
    console.log('[Claude] 📊 Page Structure Analysis:')
    
    // 1. Count all iframes on the page
    const iframeCount = page.frames().length - 1 // Subtract main frame
    console.log(`[Claude]   • Total iframes: ${iframeCount}`)
    
    if (iframeCount > 0) {
      console.log('[Claude]   • Detailed Iframe Analysis:')
      
      for (let i = 1; i < page.frames().length; i++) {
        const frame = page.frames()[i]
        const url = frame.url()
        
        // Check if iframe is consent-related
        const consentKeywords = ['consent', 'cookie', 'privacy', 'cmp', 'quantcast', 'onetrust', 'cookiebot', 'trustarc', 'didomi']
        const isConsentFrame = consentKeywords.some(keyword => url.toLowerCase().includes(keyword))
        
        // Try to get iframe title/name from parent page
        let iframeInfo = { title: 'unknown', visible: false, hasButton: false }
        try {
          iframeInfo = await page.evaluate((frameUrl) => {
            const iframes = Array.from(document.querySelectorAll('iframe'))
            const matchingIframe = iframes.find(iframe => iframe.src === frameUrl || iframe.contentWindow?.location.href === frameUrl)
            if (matchingIframe) {
              const rect = matchingIframe.getBoundingClientRect()
              return {
                title: matchingIframe.title || matchingIframe.name || 'unnamed',
                visible: rect.width > 0 && rect.height > 0,
                width: rect.width,
                height: rect.height
              }
            }
            return { title: 'unknown', visible: false }
          }, url)
          
          // Check if iframe has buttons
          try {
            const buttonCount = await frame.locator('button, [role="button"]').count()
            iframeInfo.hasButton = buttonCount > 0
            iframeInfo.buttonCount = buttonCount
          } catch (e) {
            // Iframe might not be accessible
          }
        } catch (e) {
          // Skip if can't access iframe details
        }
        
        console.log(`[Claude]     - Frame ${i}: ${isConsentFrame ? '🎯 CONSENT FRAME' : ''}`)
        console.log(`[Claude]       URL: ${url.substring(0, 70)}...`)
        console.log(`[Claude]       Title: "${iframeInfo.title}"`)
        console.log(`[Claude]       Visible: ${iframeInfo.visible} ${iframeInfo.width ? `(${Math.round(iframeInfo.width)}x${Math.round(iframeInfo.height)}px)` : ''}`)
        console.log(`[Claude]       Buttons: ${iframeInfo.hasButton ? `${iframeInfo.buttonCount} found` : 'none found'}`)
      }
    }
    
    // 2. Search for elements containing the target text in main frame
    const mainFrameMatches = await page.evaluate((text) => {
      const elements = []
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      )
      
      const matchingElements = new Set()
      let node
      while (node = walker.nextNode()) {
        if (node.textContent.includes(text)) {
          matchingElements.add(node.parentElement)
        }
      }
      
      matchingElements.forEach(el => {
        elements.push({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 100),
          role: el.getAttribute('role'),
          id: el.id,
          class: el.className,
          inShadowDOM: false
        })
      })
      
      return elements.slice(0, 5) // Limit to first 5 matches
    }, searchText)
    
    console.log(`[Claude]   • Elements containing "${searchText}" in main frame: ${mainFrameMatches.length}`)
    mainFrameMatches.forEach((el, i) => {
      console.log(`[Claude]     ${i + 1}. <${el.tag}> role="${el.role || 'none'}" class="${el.class.substring(0, 30)}"`)
      console.log(`[Claude]        Text: "${el.text.substring(0, 60)}..."`)
    })
    
    // 3. Check for shadow DOM elements
    const hasShadowDOM = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*')
      for (const el of allElements) {
        if (el.shadowRoot) return true
      }
      return false
    })
    console.log(`[Claude]   • Shadow DOM detected: ${hasShadowDOM ? 'YES' : 'NO'}`)
    
    // 4. Count all buttons on main page
    const buttonCount = await page.locator('button, [role="button"]').count()
    console.log(`[Claude]   • Total buttons in main frame: ${buttonCount}`)
    
  } catch (error) {
    console.log('[Claude] ⚠️ Error during page structure logging:', error.message)
  }
}

/**
 * Find and click close buttons (X buttons) on popups/overlays using Claude's vision
 * Multi-level detection: checks for popups up to 3 times to handle layered popups
 * 
 * @param {Page} page - Playwright page instance
 * @param {Object} options - Configuration options
 * @param {number} options.maxAttempts - Maximum attempts per level (default: 2)
 * @param {number} options.maxLevels - Maximum popup levels to check (default: 3)
 * @returns {Promise<boolean>} - True if at least one close button was found and clicked
 */
export async function findAndClosePopupsWithClaude(page, options = {}) {
  const {
    maxAttempts = 2,
    maxLevels = 3,
  } = options

  const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0'
  const enabled = process.env.CLAUDE_CONSENT_ENABLED === 'true'

  if (!enabled) {
    console.log('[Claude] AI popup close detection is disabled (set CLAUDE_CONSENT_ENABLED=true)')
    return false
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('[Claude] AWS credentials not configured')
    return false
  }

  const popupStartTime = Date.now()
  console.log('[Claude] 🔍 Starting popup detection and closing...')

  let totalClosed = 0

  try {
    const client = getBedrockClient()

    // Check for popups at multiple levels (for layered popups)
    for (let level = 1; level <= maxLevels; level++) {
      let levelClosed = false

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStart = Date.now()
        // Wait 2 seconds before checking to allow popups to settle
        if (attempt > 1 || level > 1) {
          await page.waitForTimeout(2000)
        }

        // ✅ Take optimized screenshot (JPEG with PNG fallback)
        const screenshotStart = Date.now()
        const screenshot = await takeOptimizedScreenshot(page)
        const screenshotTime = Date.now() - screenshotStart

        // Prepare the request for Claude to find close buttons
        const payload = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg', // ✅ Updated for JPEG (works with PNG too)
                    data: screenshot.toString('base64'),
                  },
                },
                {
                  type: 'text',
                  text: `Analyze this webpage screenshot and identify if there are any popup overlays, modal dialogs, or survey popups visible that have a CLOSE button or X button.

Look for close buttons with these patterns:
- X button (usually in top-right corner)
- × symbol
- Close icon (✕, ✖, ╳)
- Text: "Close", "Schließen", "Fermer", "Cerrar", "Chiudi"
- "Skip", "Überspringen", "Passer"
- "No thanks", "Nein danke", "Non merci"

CRITICAL - DO NOT CLOSE THESE ELEMENTS:
- NEVER identify close buttons on advertisement frames or ad spaces
- NEVER close elements that are clearly part of ad content
- NEVER close small rectangular banners that might be ads (typically 300x250, 728x90, 160x600 sizes)
- NEVER close elements labeled with "Ad", "Advertisement", "Anzeige", "Werbung", "Publicité"

ONLY close these elements:
- Survey popups that block the entire page
- Newsletter signup modals
- Promotional overlays (sales, discounts, etc.)
- Subscription dialogs
- Full-page interstitials
- Video autoplay overlays
- Age verification popups
- Region selection popups

IMPORTANT: 
- Only identify close buttons for POPUPS/OVERLAYS that are blocking the main content
- Do NOT identify navigation elements, menu buttons, or content close buttons
- Ignore cookie consent buttons (those are handled separately)
- If in doubt whether something is an ad, respond with NO_POPUP

Respond in this exact format:
- If you find a close/X button on a popup (NOT an ad), respond with: CLOSE_BUTTON: <exact text or symbol>
- If no popup close button is visible, respond with: NO_POPUP

Examples:
- CLOSE_BUTTON: ×
- CLOSE_BUTTON: X
- CLOSE_BUTTON: Schließen
- CLOSE_BUTTON: Skip
- NO_POPUP`,
                },
              ],
            },
          ],
        }

        // Call Bedrock with Claude model
        const bedrockStart = Date.now()
        const command = new InvokeModelCommand({
          modelId: modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(payload),
        })

        const response = await client.send(command)
        const bedrockTime = Date.now() - bedrockStart
        console.log(`[Claude Popup] ⏱️ Bedrock API call: ${bedrockTime}ms`)
        
        const responseBody = JSON.parse(new TextDecoder().decode(response.body))

        // Parse Claude's response
        if (responseBody.content && responseBody.content.length > 0) {
          const textBlock = responseBody.content.find(block => block.type === 'text')
          
          if (textBlock && textBlock.text) {
            const responseText = textBlock.text.trim()

            // Check if no popup found
            if (responseText.includes('NO_POPUP')) {
              break // Move to next level or finish
            }

            // Extract close button text
            const buttonTextMatch = responseText.match(/CLOSE_BUTTON:\s*(.+?)(?:\n|$)/i)
            if (buttonTextMatch) {
              const buttonText = buttonTextMatch[1].trim()
              console.log(`[Claude] ✅ Working - Identified close button: "${buttonText}"`)

              // Try to click the close button using multiple strategies
              const clickStart = Date.now()
              const clicked = await tryClickCloseButton(page, buttonText)
              const clickTime = Date.now() - clickStart
              
              if (clicked) {
                const attemptTime = Date.now() - attemptStart
                const totalTime = Date.now() - popupStartTime
                console.log(`[Claude] ✅ Completed - Clicked close button: "${buttonText}" - Attempt: ${attemptTime}ms, Total: ${totalTime}ms (screenshot: ${screenshotTime}ms, bedrock: ${bedrockTime}ms, click: ${clickTime}ms)`)
                totalClosed++
                levelClosed = true
                
                // Wait 2 seconds for popup to close and next popup to appear
                await page.waitForTimeout(2000)

                break // Move to next level
              } else {
                const attemptTime = Date.now() - attemptStart
                console.log(`[Claude Popup] ⚠️ Button identified but click failed - Attempt: ${attemptTime}ms`)
              }
            } else {
              const attemptTime = Date.now() - attemptStart
              console.log(`[Claude Popup] ⚠️ No close button found in response - Attempt: ${attemptTime}ms`)
            }
          }
        }
        
        const attemptTime = Date.now() - attemptStart
        if (attemptTime > 1000) {
          console.log(`[Claude Popup] ⚠️ Attempt ${attempt} (level ${level}) completed - Time: ${attemptTime}ms`)
        }
      }

      // If no popup was closed at this level, assume no more popups
      if (!levelClosed) {
        break
      }
    }

    const totalTime = Date.now() - popupStartTime
    if (totalClosed > 0) {
      console.log(`[Claude] ✅ Completed - Closed ${totalClosed} popup(s) - Total time: ${totalTime}ms`)
      return true
    } else {
      console.log(`[Claude Popup] ⏱️ Total popup closing time: ${totalTime}ms (no popups found)`)
      return false
    }

  } catch (error) {
    console.error('[Claude] ❌ ERROR in popup close detection:', {
      file: 'claudeConsent.js',
      function: 'findAndClosePopupsWithClaude',
      error: error.message,
      stack: error.stack
    })
    return false
  }
}

/**
 * Try to click a close button using multiple strategies optimized for X/close buttons
 * 
 * @param {Page} page - Playwright page instance
 * @param {string} buttonText - The text on the close button
 * @returns {Promise<boolean>} - True if button was clicked, false otherwise
 */
async function tryClickCloseButton(page, buttonText) {
  try {
    // Strategy 1: Try in main frame first
    const mainFrameResult = await tryClickCloseInFrame(page, buttonText, 'Main Frame')
    if (mainFrameResult) return true
    
    // Strategy 2: Try in all iframes (SKIP AD IFRAMES)
    const frames = page.frames()
    if (frames.length > 1) {
      
      // ⚠️ CRITICAL: Ad-related keywords to SKIP (NEVER click close buttons in ad iframes)
      const adKeywords = [
        'google_ads',
        'googleads',
        'googlesyndication',
        'doubleclick',
        'adservice',
        'advertising',
        'adform',
        'adition',
        'criteo',
        'pubmatic',
        'openx',
        'rubiconproject',
        'adsrvr',
        'quantserve',
        'yieldlab',
        'stroeer',
        'mediasmart',
        'smartadserver',
        '/ads/',
        '/ad/',
        'taboola',
        'outbrain'
      ]
      
      for (let i = 1; i < frames.length; i++) {
        const frame = frames[i]
        const frameUrl = frame.url().toLowerCase()
        
        // ⚠️ SKIP this iframe if it's ad-related
        const isAdFrame = adKeywords.some(keyword => frameUrl.includes(keyword))
        if (isAdFrame) {
          continue // Skip to next iframe
        }
        
        const iframeResult = await tryClickCloseInFrame(frame, buttonText, `Iframe ${i}`)
        if (iframeResult) return true
      }
    }

    return false

  } catch (error) {
    console.error('[Claude] ❌ ERROR in tryClickCloseButton:', {
      file: 'claudeConsent.js',
      function: 'tryClickCloseButton',
      error: error.message,
      stack: error.stack,
      buttonText
    })
    console.error('[Claude] Error clicking close button:', error.message)
    return false
  }
}

/**
 * Try to click close button in a specific frame
 * Enhanced to try ALL matching elements (not just .first()) since there may be hidden buttons
 * 
 * @param {Frame|Page} frame - Playwright frame or page instance
 * @param {string} buttonText - The text on the close button
 * @param {string} frameLabel - Label for logging
 * @returns {Promise<boolean>} - True if button was clicked, false otherwise
 */
async function tryClickCloseInFrame(frame, buttonText, frameLabel) {
  const CLICK_TIMEOUT = 5000
  const CLICK_OPTIONS = { 
    timeout: CLICK_TIMEOUT, 
    force: true 
  }

  // ⚠️ CRITICAL: Helper function to check if element is ad-related
  const isAdElement = async (locator, index = 0) => {
    try {
      const adPatterns = [
        'google_ads', 'googleads', 'doubleclick', 'adsense',
        'ad-container', 'ad-slot', 'ad-frame', 'advertisement',
        'adservice', 'adform', 'criteo', 'pubmatic'
      ]
      
      const element = locator.nth(index)
      const id = await element.getAttribute('id').catch(() => null)
      const className = await element.getAttribute('class').catch(() => null)
      const ariaLabel = await element.getAttribute('aria-label').catch(() => null)
      
      const allAttributes = [id, className, ariaLabel].filter(Boolean).join(' ').toLowerCase()
      
      return adPatterns.some(pattern => allAttributes.includes(pattern))
    } catch {
      return false // If we can't check, assume it's safe
    }
  }

  try {
    // Strategy 1: Try button with exact text (try ALL matches, not just first)
    try {
      const exactButton = frame.getByRole('button', { name: buttonText, exact: true })
      const count = await exactButton.count()
      if (count > 0) {
        // Try all buttons, not just first (some may be hidden)
        for (let i = 0; i < count; i++) {
          try {
            // ⚠️ SAFETY CHECK: Skip if this is an ad element
            if (await isAdElement(exactButton, i)) {
              continue
            }
            
            await exactButton.nth(i).click(CLICK_OPTIONS)
            return true
          } catch (e) {
            // Silent fail, try next
          }
        }
      }
    } catch (error) {
      // Silent fail
    }

    // Strategy 2: Try button with partial text (try ALL matches)
    try {
      const partialButton = frame.getByRole('button', { name: new RegExp(buttonText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
      const count = await partialButton.count()
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          try {
            await partialButton.nth(i).click(CLICK_OPTIONS)
            return true
          } catch (e) {
            // Silent fail, try next
          }
        }
      }
    } catch (error) {
      // Silent fail
    }

    // Strategy 3: Try text selector (try ALL matches)
    try {
      const textSelector = frame.locator(`text="${buttonText}"`)
      const count = await textSelector.count()
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          try {
            // ⚠️ SAFETY CHECK: Skip if this is an ad element
            if (await isAdElement(textSelector, i)) {
              continue
            }
            
            await textSelector.nth(i).click(CLICK_OPTIONS)
            return true
          } catch (e) {
            // Silent fail, try next
          }
        }
      }
    } catch (error) {
      // Silent fail
    }

    // Strategy 4: Try getByText (try ALL matches)
    try {
      const getByText = frame.getByText(buttonText, { exact: false })
      const count = await getByText.count()
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          try {
            await getByText.nth(i).click(CLICK_OPTIONS)
            return true
          } catch (e) {
            // Silent fail, try next
          }
        }
      }
    } catch (error) {
      // Silent fail
    }

    // Strategy 5: Try common close button selectors (try ALL matches for each selector)
    if (buttonText === 'X' || buttonText === '×' || buttonText === '✕' || buttonText.toLowerCase().includes('close') || buttonText.toLowerCase().includes('schließen')) {
      const closeSelectors = [
        // Custom HTML elements (like <hmg-banner-close-btn>, <app-close-button>, etc.)
        '*[class*="banner"][class*="close"]',
        '*[class*="close"][class*="btn"]',
        '*[class*="close"][class*="button"]',
        'hmg-banner-close-btn',
        'hmg-banner-close',
        '[class*="hmg-banner-close"]',
        
        // Standard button elements with attributes
        'button[aria-label*="close" i]',
        'button[aria-label*="schließen" i]',
        'button[title*="close" i]',
        'button[title*="schließen" i]',
        '[role="button"][aria-label*="close" i]',
        'button.close',
        'button.close-button',
        'button.modal-close',
        'button.popup-close',
        '[data-dismiss="modal"]',
        'button[class*="close"]',
        'button[class*="Close"]',
        '[class*="close-button"]',
        
        // Any clickable element (div, span, a, etc.) with close attributes
        'div[aria-label*="close" i]',
        'span[aria-label*="close" i]',
        'a[aria-label*="close" i]',
        'div[title*="close" i]',
        'span[title*="close" i]',
        'a[title*="close" i]',
        'div[class*="close"]',
        'span[class*="close"]',
        'a[class*="close"]',
        
        // Generic close selectors (any element)
        '[data-testid*="close" i]',
        '[data-test*="close" i]',
        '[id*="close" i]',
        '[class*="banner-close"]',
        '[class*="popup-close"]',
        '[class*="modal-close"]',
        '[class*="overlay-close"]',
      ]

      for (const selector of closeSelectors) {
        try {
          const element = frame.locator(selector)
          const count = await element.count()
          if (count > 0) {
            // Try ALL matching elements, not just first
            for (let i = 0; i < count; i++) {
              try {
                // ⚠️ SAFETY CHECK: Skip if this is an ad element
                if (await isAdElement(element, i)) {
                  continue
                }
                
                await element.nth(i).click(CLICK_OPTIONS)
                return true
              } catch (e) {
                // Silent fail, try next
              }
            }
          }
        } catch (error) {
          // Silent fail, try next selector
        }
      }
    }

    return false

  } catch (error) {
    console.error('[Claude] ❌ ERROR in tryClickCloseInFrame:', {
      file: 'claudeConsent.js',
      function: 'tryClickCloseInFrame',
      frameLabel,
      buttonText,
      error: error.message,
      stack: error.stack
    })
    return false
  }
}

/**
 * Check if Claude consent detection is properly configured
 * 
 * @returns {Object} Configuration status
 */
export function getClaudeConsentStatus() {
  return {
    enabled: process.env.CLAUDE_CONSENT_ENABLED === 'true',
    configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    modelId: process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0',
  }
}

