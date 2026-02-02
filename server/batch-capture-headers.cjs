#!/usr/bin/env node

/**
 * Batch Header Capture Script
 * 
 * Processes a list of URLs and captures headers for each site.
 * Headers are saved to server/output-ss-files/
 * 
 * Usage:
 *   node batch-capture-headers.cjs [device]
 * 
 * Examples:
 *   node batch-capture-headers.cjs macbook-air
 *   node batch-capture-headers.cjs iphone16
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// List of 40 URLs to process
const URLS = [
  'https://www.schoener-wohnen.de/',
  'https://www.tz.de/',
  'https://www.zeit.de/index',
  'https://www.t-online.de/',
  'https://www.bild.de/',
  'https://www.wiwo.de/',
  'https://www.brigitte.de/',
  'https://www.wetter.com/',
  'https://www.sueddeutsche.de/',
  'https://sportbild.bild.de/',
  'https://www.cosmopolitan.de/',
  'https://www.geo.de/',
  'https://intouch.wunderweib.de/',
  'https://www.augsburger-allgemeine.de/',
  'https://www.techbook.de/',
  'https://www.faz.net/aktuell/',
  'https://www.focus.de/',
  'https://www.chefkoch.de/',
  'https://www.waz.de/',
  'https://www.blick.ch/',
  'https://www.nzz.ch/',
  'https://www.fandom.com/',
  'https://www.menshealth.com/',
  'https://www.mannheimer-morgen.de/',
  'https://www.freundin.de/',
  'https://www.chip.de/',
  'https://www.bunte.de/',
  'https://www.essen-und-trinken.de/',
  'https://www.holidaycheck.de/',
  'https://www.baby-vornamen.de/',
  'https://www.stern.de/',
  'https://www.yahoo.com/?guccounter=1',
  'https://www.manager-magazin.de/hbm/',
  'https://www.boerse-online.de/',
  'https://www.aol.de/?guccounter=1',
  'https://www.spiegel.de/',
  'https://www.aerztezeitung.de/',
  'https://www.wunderweib.de/',
  'https://www.sport1.de/',
  'https://www.familie.de/'
];

// Try to load dotenv if available
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

// Ensure Claude consent is enabled for testing
if (!process.env.CLAUDE_CONSENT_ENABLED) {
  process.env.CLAUDE_CONSENT_ENABLED = 'true';
}

// Suppress Redis errors in test mode
process.env.TEST_MODE = 'true';
process.env.SUPPRESS_REDIS_ERRORS = 'true';

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

// Import header capture function
async function loadHeaderCapture() {
  const { captureHeaderAsync } = await import('./src/utils/headerCapture.js');
  return captureHeaderAsync;
}

async function captureHeaderForUrl(url, device, outputDir, browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  try {
    // Set viewport based on device
    const viewports = {
      'iphone16': { width: 393, height: 852, deviceScaleFactor: 1 },
      'macbook-air': { width: 1440, height: 900, deviceScaleFactor: 1 },
    };
    const viewport = viewports[device] || viewports['macbook-air'];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Navigate to page
    log('🌐', `Navigating to ${url}...`, colors.blue);
    
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });
    } catch (gotoError) {
      log('⚠️', `Navigation failed for ${url}: ${gotoError.message}`, colors.yellow);
      return { success: false, error: 'Navigation failed' };
    }

    // Brief wait for initial content
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Handle consent (if needed) - quick attempt
    try {
      const { findAndClickConsentWithClaude } = await import('./src/utils/claudeConsent.js');
      await findAndClickConsentWithClaude(page, {
        maxAttempts: 1,
        takeScreenshotAfter: false,
      });
    } catch (consentError) {
      // Continue even if consent handling fails
    }

    // Capture header
    const captureHeaderAsync = await loadHeaderCapture();
    const headerResult = await captureHeaderAsync(page, url, device, outputDir).catch(err => {
      log('⚠️', `Header capture failed for ${url}: ${err.message}`, colors.yellow);
      return null;
    });

    if (headerResult) {
      log('✅', `${url} - Header captured: ${headerResult.headerWidth}x${headerResult.headerHeight}`, colors.green);
      return { success: true, headerResult };
    } else {
      log('⚠️', `${url} - Header not captured`, colors.yellow);
      return { success: false, error: 'Header not detected' };
    }

  } catch (error) {
    log('❌', `${url} - Error: ${error.message}`, colors.red);
    return { success: false, error: error.message };
  } finally {
    await page.close();
    await context.close();
  }
}

async function batchCaptureHeaders(device = 'macbook-air') {
  const outputDir = path.join(__dirname, 'output-ss-files');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  log('🎯', `Batch Header Capture - ${URLS.length} URLs`, colors.bright);
  log('📱', `Device: ${device}`, colors.cyan);
  log('📁', `Output directory: ${outputDir}`, colors.cyan);
  console.log('');

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

  const results = {
    total: URLS.length,
    success: 0,
    failed: 0,
    errors: []
  };

  const startTime = Date.now();

  try {
    // Process each URL
    for (let i = 0; i < URLS.length; i++) {
      const url = URLS[i];
      const progress = `[${i + 1}/${URLS.length}]`;
      
      console.log('');
      log('📋', `${progress} Processing: ${url}`, colors.bright);
      
      const result = await captureHeaderForUrl(url, device, outputDir, browser);
      
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ url, error: result.error });
      }

      // Brief pause between requests
      if (i < URLS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

  } finally {
    await browser.close();
  }

  const totalTime = Date.now() - startTime;

  // Display summary
  console.log('');
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  log('📊', 'Batch Processing Summary', colors.bright);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`  ${colors.cyan}Total URLs:${colors.reset} ${results.total}`);
  console.log(`  ${colors.green}Success:${colors.reset} ${results.success}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${results.failed}`);
  console.log(`  ${colors.cyan}Total Time:${colors.reset} ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`  ${colors.cyan}Average Time:${colors.reset} ${(totalTime / results.total / 1000).toFixed(2)}s per URL`);
  console.log('');

  if (results.errors.length > 0) {
    console.log(`${colors.yellow}Failed URLs:${colors.reset}`);
    results.errors.forEach(({ url, error }) => {
      console.log(`  ${colors.red}✗${colors.reset} ${url} - ${error}`);
    });
    console.log('');
  }

  log('🎉', 'Batch processing complete!', colors.bright);
  log('📁', `Headers saved to: ${outputDir}`, colors.cyan);
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const device = args[0] || 'macbook-air';

  if (device !== 'macbook-air' && device !== 'iphone16') {
    console.log(`
${colors.bright}📦 Batch Header Capture Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node batch-capture-headers.cjs [device]

${colors.cyan}Devices:${colors.reset}
  • macbook-air (default)
  • iphone16

${colors.cyan}Output:${colors.reset}
  Headers will be saved to: ${colors.green}server/output-ss-files/${colors.reset}
    `);
    process.exit(0);
  }

  batchCaptureHeaders(device).catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { batchCaptureHeaders, URLS };


