#!/usr/bin/env node

/**
 * Standalone Webpage Loading Test Script
 * 
 * Usage:
 *   node test-webpage-loading.cjs <url> [device]
 * 
 * Examples:
 *   node test-webpage-loading.cjs https://www.blick.ch/
 *   node test-webpage-loading.cjs https://www.zeit.de/index macbook-air
 * 
 * Output:
 *   - Full-page screenshot → server/output-ss-files/
 *   - Timing information in console
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Try to load dotenv if available, otherwise manually parse .env
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (e) {
  // Fallback: manually load .env file
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key.trim()] = value.trim();
        }
      }
    });
  }
}

// Ensure Claude consent is enabled for testing (can be overridden by .env)
if (!process.env.CLAUDE_CONSENT_ENABLED) {
  process.env.CLAUDE_CONSENT_ENABLED = 'true';
  console.log('⚠️  CLAUDE_CONSENT_ENABLED not set, defaulting to true for testing');
}

// Suppress Redis errors in test mode
process.env.TEST_MODE = 'true';
process.env.SUPPRESS_REDIS_ERRORS = 'true';

// Check if AWS credentials are set
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.log('⚠️  AWS credentials not found. Claude consent detection requires AWS credentials.');
  console.log('   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env file');
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(emoji, message, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

// Import ES modules dynamically
async function loadESModules() {
  const { setPreConsentCookies } = await import('./src/utils/consent.js');
  const { findAndClickConsentWithClaude, findAndClosePopupsWithClaude } = await import('./src/utils/claudeConsent.js');
  const { detectAdsWithClaude } = await import('./src/utils/claudeAdDetection.js');
  const { autoScroll, eagerLoadLazyResources } = await import('./src/utils/autoScroll.js');
  const { sleep } = await import('./src/utils/sleep.js');
  const { captureHeaderAsync } = await import('./src/utils/headerCapture.js');
  
  return {
    setPreConsentCookies,
    findAndClickConsentWithClaude,
    findAndClosePopupsWithClaude,
    detectAdsWithClaude,
    autoScroll,
    eagerLoadLazyResources,
    sleep,
    captureHeaderAsync
  };
}

async function testWebpageLoading(url, device = 'iphone16') {
  const outputDir = path.join(__dirname, 'output-ss-files');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  log('🎯', `Testing Website: ${url}`, colors.bright);
  log('📱', `Device: ${device}`, colors.cyan);
  log('📁', `Output directory: ${outputDir}`, colors.cyan);
  console.log('');
  
  // Load ES modules
  const utils = await loadESModules();
  const { setPreConsentCookies, findAndClickConsentWithClaude, findAndClosePopupsWithClaude, detectAdsWithClaude, autoScroll, eagerLoadLazyResources, sleep, captureHeaderAsync } = utils;
  
  // Launch browser
  log('🚀', 'Launching browser...', colors.blue);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ]
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);
  
  const startTime = Date.now();
  const timings = {};
  
  try {
    // Set viewport based on device
    const viewports = {
      'iphone16': { width: 393, height: 852, deviceScaleFactor: 1 },
      'macbook-air': { width: 1440, height: 900, deviceScaleFactor: 1 },
    };
    const viewport = viewports[device] || viewports['iphone16'];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    log('📐', `Viewport set: ${viewport.width}x${viewport.height}`, colors.cyan);
    
    // Navigate to page
    const navStart = Date.now();
    log('🌐', `Navigating to ${url}...`, colors.blue);
    
    // Set pre-consent cookies
    await setPreConsentCookies(page, url);
    
    // Try multiple wait strategies
    let gotoSuccess = false;
    const waitStrategies = ['commit', 'domcontentloaded', 'load'];
    
    for (const waitUntil of waitStrategies) {
      try {
        await page.goto(url, { 
          waitUntil,
          timeout: 120000
        });
        gotoSuccess = true;
        break;
      } catch (gotoError) {
        if (waitUntil === waitStrategies[waitStrategies.length - 1]) {
          throw gotoError;
        }
      }
    }
    
    if (!gotoSuccess) {
      throw new Error('All navigation wait strategies failed');
    }
    
    timings.navigation = Date.now() - navStart;
    log('✅', `Navigation complete (${timings.navigation}ms)`, colors.green);
    
    // Brief wait for initial content
    const initialWaitStart = Date.now();
    log('⏳', 'Waiting for initial content (2000ms)...', colors.yellow);
    await sleep(2000);
    timings.initialWait = Date.now() - initialWaitStart;
    
    // Smart top ad triggering: small scrolls + refresh detection
    log('🔄', 'Triggering top ad elements with smart scrolling...', colors.blue);
    const topAdTriggerStart = Date.now();
    
    // Function to check for frame changes in top area (indicating ads loading)
    const checkTopAreaChanges = async () => {
      return await page.evaluate(() => {
        // Check top 2 viewports for iframes, ads, or dynamic content
        const topArea = {
          y: 0,
          height: window.innerHeight * 2 // Top 2 viewports
        };
        
        const elements = Array.from(document.querySelectorAll('iframe, [id*="ad"], [class*="ad"], [id*="banner"], [class*="banner"]'));
        const topElements = elements.filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.top >= topArea.y && rect.top < topArea.height;
        });
        
        return {
          iframeCount: topElements.filter(el => el.tagName === 'IFRAME').length,
          adElementCount: topElements.length,
          totalElements: elements.length
        };
      });
    };
    
    // Get initial state
    let previousState = await checkTopAreaChanges();
    let scrollAttempts = 0;
    const maxTopScrollAttempts = 5;
    
    // Small scrolls at top to trigger ads
    while (scrollAttempts < maxTopScrollAttempts) {
      // Small scroll down (100-200px)
      const scrollAmount = 100 + (scrollAttempts * 50); // Gradually increase
      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      await sleep(400); // Wait for potential ad loading
      
      // Eager load after each scroll
      await eagerLoadLazyResources(page);
      await sleep(200);
      
      // Check for changes
      const currentState = await checkTopAreaChanges();
      
      // If we see new iframes or ad elements, ads might be loading
      if (currentState.iframeCount > previousState.iframeCount || 
          currentState.adElementCount > previousState.adElementCount) {
        log('✅', `Top ads detected (${currentState.iframeCount} iframes, ${currentState.adElementCount} ad elements)`, colors.green);
        log('⏳', 'Waiting 2.5s for ads to stabilize...', colors.yellow);
        await sleep(2500); // Wait 2.5 seconds for ads to fully load and stabilize
        break;
      }
      
      // Scroll back up slightly
      await page.evaluate((amount) => {
        window.scrollBy(0, -amount * 0.5);
      }, scrollAmount);
      await sleep(300);
      
      previousState = currentState;
      scrollAttempts++;
      
      // Try refresh on 3rd attempt if no changes
      if (scrollAttempts === 3) {
        log('🔄', 'Trying page refresh to trigger ads...', colors.yellow);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(1000);
        await eagerLoadLazyResources(page);
        const stateAfterRefresh = await checkTopAreaChanges();
        
        // Check if refresh triggered ads
        if (stateAfterRefresh.iframeCount > previousState.iframeCount || 
            stateAfterRefresh.adElementCount > previousState.adElementCount) {
          log('✅', `Top ads detected after refresh (${stateAfterRefresh.iframeCount} iframes, ${stateAfterRefresh.adElementCount} ad elements)`, colors.green);
          log('⏳', 'Waiting 2.5s for ads to stabilize...', colors.yellow);
          await sleep(2500); // Wait 2.5 seconds for ads to fully load and stabilize
          break;
        }
        
        previousState = stateAfterRefresh;
      }
    }
    
    // Track if ads were detected during the loop
    const adsDetected = scrollAttempts < maxTopScrollAttempts;
    
    // Scroll back to top
    log('⬆️', 'Scrolling back to top...', colors.blue);
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    
    // If ads were detected, wait 1s then monitor for frame movement
    if (adsDetected) {
      log('⏳', 'Waiting 1s at top, then monitoring for frame movement...', colors.yellow);
      await sleep(1000); // Initial 1s wait at top
      
      // Monitor for frame movement for up to 2s
      const monitorStart = Date.now();
      const monitorDuration = 2000; // 2 seconds
      let lastState = await checkTopAreaChanges();
      
      while (Date.now() - monitorStart < monitorDuration) {
        await sleep(300); // Check every 300ms
        const currentState = await checkTopAreaChanges();
        
        // If frames are still changing, continue monitoring
        if (currentState.iframeCount !== lastState.iframeCount || 
            currentState.adElementCount !== lastState.adElementCount) {
          log('🔄', `Frame movement detected (${currentState.iframeCount} iframes, ${currentState.adElementCount} ad elements), continuing to monitor...`, colors.cyan);
          lastState = currentState;
          // Reset timer - continue monitoring for full 2s from this point
          const remainingTime = monitorDuration - (Date.now() - monitorStart);
          if (remainingTime > 0) {
            await sleep(Math.min(remainingTime, 300));
          }
        }
      }
      log('✅', 'Frame monitoring complete, ads should be stable', colors.green);
    } else {
      await sleep(500); // Standard settle time if no ads detected
    }
    
    timings.topAdTrigger = Date.now() - topAdTriggerStart;
    log('✅', `Top ad triggering complete (${timings.topAdTrigger}ms)`, colors.green);
    
    // AI-powered consent detection (first attempt - after initial load)
    const consentStart = Date.now();
    log('🤖', 'Attempting AI-powered consent detection with Claude (first attempt)...', colors.magenta);
    const claudeHandledConsent = await findAndClickConsentWithClaude(page, {
      maxAttempts: 2,
      takeScreenshotAfter: true,
    });
    
    if (claudeHandledConsent) {
      log('✅', 'Claude successfully handled consent popup (first attempt)', colors.green);
    } else {
      log('⚠️', 'Claude did not detect consent popup (first attempt), continuing...', colors.yellow);
    }
    timings.consentFirst = Date.now() - consentStart;
    
    // Capture header after consent handling (consent popups might have covered header)
    log('📋', 'Capturing header...', colors.blue);
    const headerStart = Date.now();
    const headerResult = await captureHeaderAsync(page, url, device, outputDir).catch(err => {
      log('⚠️', `Header capture failed: ${err.message}`, colors.yellow);
      return null;
    });
    timings.headerCapture = Date.now() - headerStart;
    if (headerResult) {
      log('✅', `Header captured: ${headerResult.headerWidth}x${headerResult.headerHeight}`, colors.green);
    } else {
      log('⚠️', 'Header not captured', colors.yellow);
    }
    
    // Eager-load lazy resources (additional pass before scrolling)
    const eagerLoadStart = Date.now();
    log('🚀', 'Eager-loading lazy resources (pre-scroll pass)...', colors.blue);
    await eagerLoadLazyResources(page);
    await sleep(200);
    timings.eagerLoad = Date.now() - eagerLoadStart;
    
    // Slow, careful auto-scroll with eager loading throughout
    const scrollStart = Date.now();
    log('🔄', 'Starting slow, careful auto-scroll with eager loading...', colors.blue);
    
    // Custom slow scroll with eager loading
    let scrollCount = 0;
    let previousHeight = 0;
    let stableCount = 0;
    const maxScrolls = 80; // Reduced from 100
    const scrollDelay = 600; // Slower: 600ms between scrolls (was 400ms)
    const scrollStep = 600; // Smaller steps: 600px (was 800px) for more thorough coverage
    
    log('📜', 'Phase 1: Slow scrolling to bottom with eager loading...', colors.cyan);
    
    while (scrollCount < maxScrolls) {
      // Get current page height
      const { currentHeight, scrollY, viewportHeight } = await page.evaluate(() => {
        return {
          currentHeight: Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.offsetHeight
          ),
          scrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
          viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0
        };
      });
      
      // Check if height is stable
      if (currentHeight === previousHeight) {
        stableCount++;
        const nearBottom = scrollY + viewportHeight >= currentHeight - 100;
        if (stableCount >= 3 && nearBottom) {
          log('✅', 'Page height stable and at bottom, stopping scroll', colors.green);
          break;
        }
      } else {
        stableCount = 0;
        previousHeight = currentHeight;
      }
      
      // Scroll down slowly
      await page.evaluate((step) => {
        window.scrollBy(0, step);
      }, scrollStep);
      
      // Eager load after EVERY scroll (critical for no missing elements)
      await eagerLoadLazyResources(page);
      
      // Wait for content to load (slower for thoroughness)
      await sleep(scrollDelay);
      
      // Check for images loading (every 4 scrolls to balance thoroughness and speed)
      if (scrollCount % 4 === 0) {
        await page.evaluate(() => {
          return Promise.all(
            Array.from(document.images)
              .filter(img => {
                const rect = img.getBoundingClientRect();
                return !img.complete && rect.width > 0 && rect.height > 0;
              })
              .slice(0, 20) // Check more images
              .map(img => {
                return new Promise((resolve) => {
                  img.onload = resolve;
                  img.onerror = resolve;
                  setTimeout(resolve, 1500); // 1.5s timeout per image
                });
              })
          );
        });
      }
      
      scrollCount++;
      if (scrollCount % 10 === 0 || scrollCount === 1) {
        log('📊', `Scroll ${scrollCount}/${maxScrolls}, height: ${currentHeight}px`, colors.cyan);
      }
    }
    
    // Final scroll to very bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight);
    });
    await sleep(500);
    
    // Scroll back to top
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await sleep(500);
    
    timings.scroll = Date.now() - scrollStart;
    log('✅', `Slow auto-scroll complete (${timings.scroll}ms, ${scrollCount} scrolls)`, colors.green);
    
    // Smart network check - monitor active requests with shorter timeout
    const networkStart = Date.now();
    log('🌐', 'Checking network activity...', colors.blue);
    
    try {
      const maxWait = 6000; // 6 seconds max (reduced from 8s to fit 60-70s total)
      const idleThreshold = 1200; // 1.2 seconds of no new requests = idle
      const checkInterval = 300; // Check every 300ms
      
      // Track requests and responses using Playwright events
      const pendingRequests = new Map();
      let lastRequestTime = Date.now();
      let stableCount = 0;
      
      const requestHandler = (request) => {
        pendingRequests.set(request.url(), Date.now());
        lastRequestTime = Date.now();
        stableCount = 0;
      };
      
      const responseHandler = (response) => {
        pendingRequests.delete(response.url());
      };
      
      page.on('request', requestHandler);
      page.on('response', responseHandler);
      
      // Poll until network is idle or max wait reached
      while (Date.now() - networkStart < maxWait) {
        await sleep(checkInterval);
        
        const activeCount = pendingRequests.size;
        const timeSinceLastRequest = Date.now() - lastRequestTime;
        
        if (activeCount === 0 && timeSinceLastRequest >= idleThreshold) {
          stableCount++;
          if (stableCount >= 2) { // Confirmed idle for 2 checks
            break;
          }
        } else {
          stableCount = 0;
        }
      }
      
      // Clean up event listeners
      page.off('request', requestHandler);
      page.off('response', responseHandler);
      
      timings.networkIdle = Date.now() - networkStart;
      if (timings.networkIdle >= maxWait) {
        log('⚠️', `Network check timeout (${maxWait}ms), continuing...`, colors.yellow);
      } else {
        log('✅', `Network settled (${timings.networkIdle}ms)`, colors.green);
      }
    } catch (e) {
      timings.networkIdle = Date.now() - networkStart;
      log('⚠️', 'Network check failed, continuing...', colors.yellow);
    }
    
    // Final content readiness check
    const contentStart = Date.now();
    log('🖼️', 'Final content readiness check...', colors.blue);
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      // Wait for visible images only (optimized timeout)
      const images = Array.from(document.querySelectorAll('img'))
        .filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      
      const imagePromises = images.map(img => {
        if (img.complete && img.naturalHeight > 0) return Promise.resolve();
        return new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1500); // Reduced from 2000ms
          img.onload = () => { clearTimeout(timeout); resolve(); }
          img.onerror = () => { clearTimeout(timeout); resolve(); }
        });
      });
      await Promise.all(imagePromises);
      
      // Wait for visible iframes only (optimized timeout)
      const iframes = Array.from(document.querySelectorAll('iframe'))
        .filter(iframe => {
          const rect = iframe.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      
      const iframePromises = iframes.map(iframe => {
        return new Promise((resolve) => {
          const timeout = setTimeout(resolve, 2500); // Reduced from 3000ms
          if (iframe.contentDocument?.readyState === 'complete') {
            clearTimeout(timeout);
            resolve();
          } else {
            iframe.onload = () => { clearTimeout(timeout); resolve(); }
            iframe.onerror = () => { clearTimeout(timeout); resolve(); }
          }
        });
      });
      await Promise.all(iframePromises);
      
      await sleep(800); // Reduced from 1000ms
    });
    timings.contentCheck = Date.now() - contentStart;
    
    // Scroll back to top
    log('⬆️', 'Scrolling to top for final screenshot...', colors.blue);
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await sleep(300);
    
    // AI-powered consent detection (second attempt - after content load)
    const consentAfterStart = Date.now();
    log('🤖', 'Scanning for cookie banners after content load with Claude (second attempt)...', colors.magenta);
    const claudeHandledConsentAfterLoad = await findAndClickConsentWithClaude(page, {
      maxAttempts: 1,
      takeScreenshotAfter: false,
    });
    
    if (claudeHandledConsentAfterLoad) {
      log('✅', 'Claude handled consent popup after content load', colors.green);
    } else {
      log('⚠️', 'No consent popup detected after content load', colors.yellow);
    }
    timings.consentAfter = Date.now() - consentAfterStart;
    
    // Check for popups
    const popupStart = Date.now();
    log('🔍', 'Scanning for popup close buttons before screenshot...', colors.blue);
    await findAndClosePopupsWithClaude(page, {
      maxAttempts: 2,
      maxLevels: 3,
    });
    timings.popupCheck = Date.now() - popupStart;
    
    // Prepare for screenshot
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await sleep(300);
    
    // Detect ads using both selector patterns and Claude AI
    log('🔍', 'Detecting ads with selector patterns and Claude AI...', colors.magenta);
    const adDetectionStart = Date.now();
    
    // 1. Detect ads using 12 selector patterns
    log('📊', 'Running 12 selector pattern detection...', colors.cyan);
    const selectorAds = await page.evaluate(() => {
      const isSizeMatch = (rect, width, height, tolerance = 5) => {
        return Math.abs(rect.width - width) <= tolerance && Math.abs(rect.height - height) <= tolerance
      }

      const shouldSkipAsStandardMpu = (rect) => isSizeMatch(rect, 300, 250)
      const toAbs = (el) => {
        const r = el.getBoundingClientRect()
        const sx = window.pageXOffset || document.documentElement.scrollLeft || 0
        const sy = window.pageYOffset || document.documentElement.scrollTop || 0
        return { x: Math.round(r.left + sx), y: Math.round(r.top + sy) }
      }
      
      const getSize = (el) => {
        const r = el.getBoundingClientRect()
        return { width: Math.round(r.width), height: Math.round(r.height) }
      }
      
      const adElements = []
      let adCounter = 1
      
      // 1. Google ad iframes
      const googleFrames = Array.from(document.querySelectorAll('div[id^="google_ads_iframe_"]'))
      googleFrames.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `google-ad-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'iframe-google-ads',
            source: 'selector'
          })
        }
      })
      
      // 2. FlashTalking ads
      const flashTalkingAds = Array.from(document.querySelectorAll('ins.ftads.flashtalking_ads'))
      flashTalkingAds.forEach((ad, i) => {
        const r = ad.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: ad.id || `flashtalking-ad-${adCounter++}`,
            position: toAbs(ad),
            size: getSize(ad),
            type: 'flashtalking-ads',
            source: 'selector'
          })
        }
      })
      
      // 3. Google AdSense ads
      const adsenseAds = Array.from(document.querySelectorAll('ins.adsbygoogle'))
      adsenseAds.forEach((ad, i) => {
        const r = ad.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: ad.id || `adsense-ad-${adCounter++}`,
            position: toAbs(ad),
            size: getSize(ad),
            type: 'adsense-ads',
            source: 'selector'
          })
        }
      })
      
      // 4. Inside post ads
      const insidePostAds = Array.from(document.querySelectorAll('div.inside-post-ad-1.inside-post-ad.ads_common_inside_post'))
      insidePostAds.forEach((ad, i) => {
        const r = ad.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: ad.id || `inside-post-ad-${adCounter++}`,
            position: toAbs(ad),
            size: getSize(ad),
            type: 'inside-post-ads',
            source: 'selector'
          })
        }
      })
      
      // 5. Sky ad iframes
      const skyFrames = Array.from(document.querySelectorAll('iframe[id^="skyLeft__"], iframe[id^="skyRight__"]'))
      skyFrames.forEach((frame, i) => {
        const r = frame.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: frame.id || `sky-ad-${adCounter++}`,
            position: toAbs(frame),
            size: getSize(frame),
            type: frame.id.startsWith('skyLeft__') ? 'iframe-sky-left' : 'iframe-sky-right',
            source: 'selector'
          })
        }
      })
      
      // 6. MREC BTF iBanner ads
      const mrecIbannerDivs = Array.from(document.querySelectorAll('div[id*="mrec_btf"][id$="ibanner"]'))
      mrecIbannerDivs.forEach((div, i) => {
        const id = div.id || `mrec-btf-ibanner-${adCounter++}`
        const valid = /^mrec_btf(?:_\d+)?_ibanner$/i.test(id)
        if (!valid) return
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-mrec-btf-ibanner',
            source: 'selector'
          })
        }
      })
      
      // 7. Divs with "ibanner" in the id
      const ibannerDivs = Array.from(document.querySelectorAll('div[id*="ibanner"]'))
      ibannerDivs.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `ibanner-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-ibanner',
            source: 'selector'
          })
        }
      })
      
      // 8. Value ads
      const iqdValueAdDivs = Array.from(document.querySelectorAll('div[id*="iqdValueAd"]'))
      iqdValueAdDivs.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `iqd-value-ad-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-iqd-valueAd',
            source: 'selector'
          })
        }
      })
      
      // 8b. Sidebar wrapper ads (all variations)
      const sidebarWrapperDivs = Array.from(
        document.querySelectorAll('div[id="iqdSitebarL"], div[id="iqdSitebar"], div[id="iqdSitebarWrapperL"], div[id="iqdSitebarWrapper"]')
      );
      
      sidebarWrapperDivs.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `sidebar-wrapper-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-sidebar-wrapper',
            source: 'selector'
          })
        }
      });
      
      // 8c. Divs with IDs containing ad position keywords
      const adPositionDivs = Array.from(
        document.querySelectorAll('div[id*="adBanner"], div[id*="topAd"], div[id*="rightAd"], div[id*="leftAd"]')
      );
      
      adPositionDivs.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `ad-position-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-ad-position',
            source: 'selector'
          })
        }
      });
      
      // 9. ContainerSize_728X90
      const ContainerSize728X90Divs = Array.from(document.querySelectorAll('div[id*="container-728x90"]'))
      ContainerSize728X90Divs.forEach((div, i) => {
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: div.id || `container-728x90-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-container-728x90',
            source: 'selector'
          })
        }
      })
      
      // 10. Superbanners & banner containers
      const bannerCandidates = Array.from(document.querySelectorAll('div[id*="superbanner"], div[id*="banner_bannerCont"]'))
      const superbannerRegex = /(^superbanner_[^_\s]+_(?:leftBar|rightBar)$)/i
      const superbannerBannerContRegex = /superbanner_bannerCont/i
      const bannerBannerContRegex = /banner_bannerCont/i
      
      bannerCandidates.forEach((div, i) => {
        const id = div.id || ''
        const isSuperLeftRight = superbannerRegex.test(id)
        const isSuperBannerCont = superbannerBannerContRegex.test(id)
        const isBannerBannerCont = bannerBannerContRegex.test(id)
        if (!isSuperLeftRight && !isSuperBannerCont && !isBannerBannerCont) return
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: id || `bar-banner-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: 'div-generic-bar-banner',
            source: 'selector'
          })
        }
      })
      
      // 11. Sky slots
      const skyCandidates = Array.from(document.querySelectorAll('div[id*="sky_"], div[id*="rlSlot"]'))
      const skyRegex = /^(?:sky_[^_\s]+_(?:leftBar|rightBar)|sky_rlSlot_[^_\s]+_(?:leftBar|rightBar))$/i
      skyCandidates.forEach((div, i) => {
        const id = div.id || ''
        if (!skyRegex.test(id)) return
        const r = div.getBoundingClientRect()
        if (r.width >= 20 && r.height >= 20 && !shouldSkipAsStandardMpu(r)) {
          adElements.push({
            id: id || `sky-slot-${adCounter++}`,
            position: toAbs(div),
            size: getSize(div),
            type: id.toLowerCase().includes('leftbar') ? 'div-sky-leftbar' : 'div-sky-rightbar',
            source: 'selector'
          })
        }
      })
      
      // 12. Generic ad-sized iframes
      const adSizeProfiles = [{ width: 300, height: 250, type: 'iframe-300x250' }]
      const adSizedIframes = Array.from(document.querySelectorAll('iframe'))
      adSizedIframes.forEach((frame, i) => {
        const r = frame.getBoundingClientRect()
        if (r.width < 20 || r.height < 20) return
        for (const profile of adSizeProfiles) {
          const widthDelta = Math.abs(r.width - profile.width)
          const heightDelta = Math.abs(r.height - profile.height)
          const tolerance = 5
          if (widthDelta <= tolerance && heightDelta <= tolerance) {
            const size = getSize(frame)
            if (size.width > 0 && size.height > 0) {
              adElements.push({
                id: frame.id || `${profile.type}-${adCounter++}`,
                position: toAbs(frame),
                size: size,
                type: profile.type,
                source: 'selector'
              })
            }
            break
          }
        }
      })
      
      return adElements.filter(ad => ad.size.width > 0 && ad.size.height > 0)
    });
    
    log('✅', `Selector patterns found ${selectorAds.length} ads`, colors.green);
    
    // 2. Detect ads using Claude AI
    log('🤖', 'Running Claude AI ad detection...', colors.magenta);
    const claudeAds = await detectAdsWithClaude(page, { maxAttempts: 1 });
    
    // Convert Claude ads to same format (x, y, width, height)
    const claudeAdsFormatted = claudeAds.map(ad => ({
      position: { x: ad.x, y: ad.y },
      size: { width: ad.width, height: ad.height },
      type: 'claude-detected',
      source: 'claude-ai'
    }));
    
    log('✅', `Claude AI found ${claudeAdsFormatted.length} ads`, colors.green);
    
    // Combine both detection methods
    let allAds = [...selectorAds, ...claudeAdsFormatted];
    log('📊', `Total ads before filtering: ${allAds.length} (${selectorAds.length} selectors + ${claudeAdsFormatted.length} Claude)`, colors.cyan);
    
    // Filter and deduplicate ads
    log('🔍', 'Filtering and deduplicating ads...', colors.blue);
    
    // Step 1: Filter out small ads
    const beforeSizeFilter = allAds.length;
    allAds = allAds.filter(ad => {
      const width = ad.size.width;
      const height = ad.size.height;
      
      // Drop if both height and width are below 200px
      if (width < 200 && height < 200) {
        return false;
      }
      
      // Drop if either height or width is below 100px
      if (width < 100 || height < 100) {
        return false;
      }
      
      return true;
    });
    
    const sizeFiltered = beforeSizeFilter - allAds.length;
    if (sizeFiltered > 0) {
      log('📏', `Filtered out ${sizeFiltered} ads (too small)`, colors.yellow);
    }
    
    // Step 2: Handle overlapping ads
    const beforeOverlapFilter = allAds.length;
    const filteredAds = [];
    const processedIndices = new Set();
    
    for (let i = 0; i < allAds.length; i++) {
      if (processedIndices.has(i)) continue;
      
      const ad1 = allAds[i];
      const ad1Left = ad1.position.x;
      const ad1Right = ad1.position.x + ad1.size.width;
      const ad1Top = ad1.position.y;
      const ad1Bottom = ad1.position.y + ad1.size.height;
      const ad1Area = ad1.size.width * ad1.size.height;
      
      let shouldKeepAd1 = true;
      
      // Check against all other ads
      for (let j = i + 1; j < allAds.length; j++) {
        if (processedIndices.has(j)) continue;
        
        const ad2 = allAds[j];
        const ad2Left = ad2.position.x;
        const ad2Right = ad2.position.x + ad2.size.width;
        const ad2Top = ad2.position.y;
        const ad2Bottom = ad2.position.y + ad2.size.height;
        const ad2Area = ad2.size.width * ad2.size.height;
        
        // Check if ads overlap
        const overlapX = ad1Left < ad2Right && ad1Right > ad2Left;
        const overlapY = ad1Top < ad2Bottom && ad1Bottom > ad2Top;
        const overlaps = overlapX && overlapY;
        
        if (!overlaps) continue;
        
        // Calculate overlap area
        const overlapLeft = Math.max(ad1Left, ad2Left);
        const overlapRight = Math.min(ad1Right, ad2Right);
        const overlapTop = Math.max(ad1Top, ad2Top);
        const overlapBottom = Math.min(ad1Bottom, ad2Bottom);
        const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
        
        // Check if one is completely inside the other (super/sub frame)
        const ad1InsideAd2 = ad1Left >= ad2Left && ad1Right <= ad2Right && ad1Top >= ad2Top && ad1Bottom <= ad2Bottom;
        const ad2InsideAd1 = ad2Left >= ad1Left && ad2Right <= ad1Right && ad2Top >= ad1Top && ad2Bottom <= ad1Bottom;
        
        if (ad1InsideAd2) {
          // ad1 is sub-frame of ad2, drop ad1
          shouldKeepAd1 = false;
          processedIndices.add(i);
          break;
        } else if (ad2InsideAd1) {
          // ad2 is sub-frame of ad1, drop ad2
          processedIndices.add(j);
          continue;
        } else if (overlaps) {
          // ANY overlap (even 1%) is not tolerable - one must be removed
          // Different sources: prefer selector over claude
          if (ad1.source === 'selector' && ad2.source === 'claude-ai') {
            // Keep ad1 (selector), drop ad2 (claude)
            processedIndices.add(j);
            continue;
          } else if (ad1.source === 'claude-ai' && ad2.source === 'selector') {
            // Drop ad1 (claude), keep ad2 (selector)
            shouldKeepAd1 = false;
            processedIndices.add(i);
            break;
          } else {
            // Same source: drop the one with smaller area (or either if same area)
            if (ad1Area < ad2Area) {
              shouldKeepAd1 = false;
              processedIndices.add(i);
              break;
            } else if (ad2Area < ad1Area) {
              processedIndices.add(j);
              continue;
            } else {
              // Same area: drop ad1 (keep first one encountered)
              shouldKeepAd1 = false;
              processedIndices.add(i);
              break;
            }
          }
        }
      }
      
      if (shouldKeepAd1) {
        filteredAds.push(ad1);
      }
    }
    
    allAds = filteredAds;
    const overlapFiltered = beforeOverlapFilter - allAds.length;
    if (overlapFiltered > 0) {
      log('🔄', `Filtered out ${overlapFiltered} ads (overlapping/duplicates)`, colors.yellow);
    }
    
    log('✅', `Final ads after filtering: ${allAds.length}`, colors.green);
    if (sizeFiltered > 0 || overlapFiltered > 0) {
      log('📊', `Filtering summary: ${sizeFiltered} too small, ${overlapFiltered} overlapping/duplicates`, colors.cyan);
    }
    
    timings.adDetection = Date.now() - adDetectionStart;
    
    // Draw red outlines on detected ads (only valid, filtered ads)
    log('🎨', `Drawing red outlines on ${allAds.length} detected ads...`, colors.blue);
    
    // Validate ads before drawing
    const validAdsForDrawing = allAds.filter(ad => {
      return ad.position && 
             ad.size && 
             ad.position.x >= 0 && 
             ad.position.y >= 0 && 
             ad.size.width > 0 && 
             ad.size.height > 0 &&
             ad.size.width < 10000 && 
             ad.size.height < 10000
    });
    
    if (validAdsForDrawing.length !== allAds.length) {
      log('⚠️', `Filtered out ${allAds.length - validAdsForDrawing.length} invalid ads before drawing`, colors.yellow);
    }
    
    await page.evaluate((ads) => {
      // Remove any existing ad outlines
      const existingOutlines = document.querySelectorAll('.ad-detection-outline');
      existingOutlines.forEach(el => el.remove());
      
      // Get page dimensions for validation
      const pageHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      const pageWidth = Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth,
        document.body.offsetWidth,
        document.documentElement.offsetWidth
      );
      
      // Create overlay divs for each ad
      let drawnCount = 0;
      ads.forEach((ad, index) => {
        // Final validation before drawing
        if (!ad.position || !ad.size) return;
        if (ad.position.x < 0 || ad.position.y < 0) return;
        if (ad.size.width <= 0 || ad.size.height <= 0) return;
        if (ad.position.x > pageWidth + 1000 || ad.position.y > pageHeight + 1000) return; // Allow some margin
        
        const outline = document.createElement('div');
        outline.className = 'ad-detection-outline';
        outline.style.position = 'absolute';
        outline.style.left = `${ad.position.x}px`;
        outline.style.top = `${ad.position.y}px`;
        outline.style.width = `${ad.size.width}px`;
        outline.style.height = `${ad.size.height}px`;
        outline.style.border = '5px solid rgba(37, 99, 235, 1)'; // Thicker, prominent blue border
        outline.style.boxSizing = 'border-box';
        outline.style.pointerEvents = 'none';
        outline.style.zIndex = '999999';
        outline.style.backgroundColor = 'rgba(18, 69, 178, 0.56)'; // More prominent blue background
        outline.setAttribute('data-ad-index', index);
        outline.setAttribute('data-ad-source', ad.source || 'unknown');
        outline.setAttribute('data-ad-type', ad.type || 'unknown');
        
        document.body.appendChild(outline);
        drawnCount++;
      });
      
      return drawnCount;
    }, validAdsForDrawing).then(drawnCount => {
      if (drawnCount !== validAdsForDrawing.length) {
        log('⚠️', `Drew ${drawnCount} outlines, expected ${validAdsForDrawing.length}`, colors.yellow);
      } else {
        log('✅', `Drew ${drawnCount} ad outlines correctly`, colors.green);
      }
    });
    
    await sleep(300); // Brief wait for outlines to render
    
    // Disable animations
    log('🎬', 'Disabling animations for screenshot...', colors.blue);
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `
    });
    await sleep(200);
    
    // Take screenshot
    const screenshotStart = Date.now();
    log('📸', 'Capturing full-page screenshot with ad outlines...', colors.blue);
    
    const screenshotOptions = {
      fullPage: true,
      timeout: 180000,
      animations: 'disabled',
    };
    
    if (device === 'macbook-air') {
      screenshotOptions.type = 'jpeg';
      screenshotOptions.quality = 80;
    } else {
      screenshotOptions.type = 'png';
    }
    
    const screenshot = await page.screenshot(screenshotOptions);
    timings.screenshot = Date.now() - screenshotStart;
    
    // Save screenshot
    const urlSlug = url.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const timestamp = Date.now();
    const filename = `${urlSlug}-${device}-${timestamp}.${device === 'macbook-air' ? 'jpg' : 'png'}`;
    const filepath = path.join(outputDir, filename);
    
    fs.writeFileSync(filepath, screenshot);
    
    const totalTime = Date.now() - startTime;
    
    // Display results
    console.log('');
    log('✅', 'Processing completed successfully!', colors.green);
    log('⏱️', `Total Duration: ${(totalTime / 1000).toFixed(2)}s`, colors.cyan);
    console.log('');
    
    console.log(`${colors.bright}📊 Timing Breakdown:${colors.reset}`);
    console.log(`  ${colors.cyan}Navigation:${colors.reset} ${timings.navigation}ms`);
    console.log(`  ${colors.cyan}Initial Wait:${colors.reset} ${timings.initialWait}ms`);
    console.log(`  ${colors.cyan}Header Capture:${colors.reset} ${timings.headerCapture || 0}ms`);
    console.log(`  ${colors.cyan}Top Ad Trigger:${colors.reset} ${timings.topAdTrigger || 0}ms`);
    console.log(`  ${colors.cyan}Consent (First):${colors.reset} ${timings.consentFirst}ms`);
    console.log(`  ${colors.cyan}Eager Load:${colors.reset} ${timings.eagerLoad}ms`);
    console.log(`  ${colors.cyan}Auto-Scroll:${colors.reset} ${timings.scroll}ms`);
    console.log(`  ${colors.cyan}Network Idle:${colors.reset} ${timings.networkIdle}ms`);
    console.log(`  ${colors.cyan}Content Check:${colors.reset} ${timings.contentCheck}ms`);
    console.log(`  ${colors.cyan}Consent (After):${colors.reset} ${timings.consentAfter}ms`);
    console.log(`  ${colors.cyan}Popup Check:${colors.reset} ${timings.popupCheck}ms`);
    console.log(`  ${colors.cyan}Ad Detection:${colors.reset} ${timings.adDetection || 0}ms`);
    console.log(`  ${colors.cyan}Screenshot:${colors.reset} ${timings.screenshot}ms`);
    console.log('');
    
    console.log(`${colors.bright}📦 Output Files:${colors.reset}`);
    console.log(`  ${colors.green}✓${colors.reset} Screenshot: ${filename}`);
    console.log(`    ${colors.blue}→${colors.reset} ${filepath}`);
    if (headerResult) {
      const headerFilename = path.basename(headerResult.headerPath);
      console.log(`  ${colors.green}✓${colors.reset} Header: ${headerFilename}`);
      console.log(`    ${colors.blue}→${colors.reset} ${headerResult.headerPath}`);
    }
    console.log('');
    
    // Get page metadata
    const metadata = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      
      const scrollHeight = Math.max(
        body.scrollHeight,
        html.scrollHeight,
        body.offsetHeight,
        html.offsetHeight,
        body.clientHeight,
        html.clientHeight
      );
      
      const scrollWidth = Math.max(
        body.scrollWidth,
        html.scrollWidth,
        body.offsetWidth,
        html.offsetWidth,
        body.clientWidth,
        html.clientWidth
      );
      
      return {
        title: document.title,
        url: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        scrollHeight,
        scrollWidth,
        contentLoaded: {
          images: document.querySelectorAll('img').length,
          iframes: document.querySelectorAll('iframe').length,
          videos: document.querySelectorAll('video').length
        }
      };
    });
    
    console.log(`${colors.bright}📋 Page Metadata:${colors.reset}`);
    console.log(`  ${colors.cyan}Title:${colors.reset} ${metadata.title}`);
    console.log(`  ${colors.cyan}Dimensions:${colors.reset} ${metadata.scrollWidth}x${metadata.scrollHeight}`);
    console.log(`  ${colors.cyan}Images:${colors.reset} ${metadata.contentLoaded.images}`);
    console.log(`  ${colors.cyan}Iframes:${colors.reset} ${metadata.contentLoaded.iframes}`);
    console.log(`  ${colors.cyan}Videos:${colors.reset} ${metadata.contentLoaded.videos}`);
    console.log('');
    
    console.log(`${colors.bright}🎯 Ad Detection Results:${colors.reset}`);
    const selectorCount = allAds ? allAds.filter(ad => ad.source === 'selector').length : 0;
    const claudeCount = allAds ? allAds.filter(ad => ad.source === 'claude-ai').length : 0;
    console.log(`  ${colors.cyan}Total Ads:${colors.reset} ${allAds ? allAds.length : 0}`);
    console.log(`  ${colors.green}Selector Patterns:${colors.reset} ${selectorCount}`);
    console.log(`  ${colors.magenta}Claude AI:${colors.reset} ${claudeCount}`);
    console.log('');
    
    log('🎉', 'All done!', colors.bright);
    
    return {
      success: true,
      filepath,
      filename,
      totalTime,
      timings,
      metadata,
      header: headerResult ? {
        path: headerResult.headerPath,
        width: headerResult.headerWidth,
        height: headerResult.headerHeight
      } : null,
      adDetection: {
        total: allAds ? allAds.length : 0,
        selector: selectorCount,
        claude: claudeCount,
        ads: allAds || []
      }
    };
    
  } catch (error) {
    console.log('');
    log('❌', `Fatal error: ${error.message}`, colors.red);
    console.error(error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
${colors.bright}📦 Webpage Loading Test Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node test-webpage-loading.cjs <url> [device]

${colors.cyan}Examples:${colors.reset}
  node test-webpage-loading.cjs https://www.blick.ch/
  node test-webpage-loading.cjs https://www.zeit.de/index macbook-air
  node test-webpage-loading.cjs https://www.t-online.de/ iphone16

${colors.cyan}Devices:${colors.reset}
  • iphone16 (default) - 393x852
  • macbook-air - 1440x900

${colors.cyan}Output:${colors.reset}
  • Full-page screenshots → ${colors.green}server/output-ss-files/${colors.reset}
  • Header screenshots → ${colors.green}server/output-ss-files/${colors.reset}

${colors.cyan}Test Websites:${colors.reset}
  • https://www.blick.ch/
  • https://www.zeit.de/index
  • https://www.t-online.de/
  • https://www.chefkoch.de/
  • https://www.cosmopolitan.de/
  • https://www.stern.de/
  • https://www.bild.de/
  • https://www.techbook.de/
  • https://www.chip.de/
  • https://www.sueddeutsche.de/
    `);
    process.exit(0);
  }
  
  const url = args[0];
  const device = args[1] || 'iphone16';
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    log('❌', 'URL must start with http:// or https://', colors.red);
    process.exit(1);
  }
  
  testWebpageLoading(url, device).catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { testWebpageLoading };

