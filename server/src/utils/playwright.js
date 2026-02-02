import { chromium } from 'playwright'

// Playwright utility functions for web scraping and screenshot generation

export class PlaywrightService {
  constructor() {
    this.browser = null
    this.context = null
  }

  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        timeout: 240000,
        ignoreHTTPSErrors: true,
      })
    }
    return this.browser
  }

  async close() {
    if (this.context) {
      await this.context.close()
      this.context = null
    }
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  async getPage() {
    const browser = await this.init()
    
    // Create a new context if we don't have one
    if (!this.context) {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
      this.context = await browser.newContext({
        userAgent: ua,
        extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
        viewport: null, // Let individual pages set their own viewport
      })
      
      // Add init script to reduce automation signals
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
    }
    
    const page = await this.context.newPage()
    page.setDefaultNavigationTimeout(90000)
    page.setDefaultTimeout(90000)
    return page
  }

  async detectAdSlots(url, deviceType) {
    const page = await this.getPage()
    
    try {
      // Set viewport based on device type
      const viewport = this.getViewportForDevice(deviceType)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      
      // Navigate to the page
      await page.goto(url, { waitUntil: 'networkidle', timeout: 100000 })
      
      // Detect ad slots (placeholder implementation)
      const adSlots = await page.evaluate(() => {
        // This is a placeholder - real implementation would detect actual ad slots
        const adSelectors = [
          'div.ad',
          '[class*=\"ad\"]',
          '[id*=\"ad\"]',
          '[class*=\"banner\"]',
          '[class*=\"promo\"]',
          'iframe[src*=\"ads\"]'
        ]
        
        const slots = []
        adSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector)
          elements.forEach((el, index) => {
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              slots.push({
                id: `slot-${index}`,
                selector: selector,
                position: {
                  x: el.offsetLeft,
                  y: el.offsetTop
                },
                size: {
                  width: el.offsetWidth,
                  height: el.offsetHeight
                }
              })
            }
          })
        })
        
        return slots
      })
      
      return adSlots
    } finally {
      await page.close()
    }
  }

  async generateScreenshot(url, deviceType) {
    const page = await this.getPage()
    
    try {
      const viewport = this.getViewportForDevice(deviceType)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      
      await page.goto(url, { waitUntil: 'networkidle', timeout: 100000 })
      
      const screenshot = await page.screenshot({
        fullPage: true,
        type: 'png'
      })
      
      return screenshot
    } finally {
      await page.close()
    }
  }

  getViewportForDevice(deviceType) {
    const viewports = {
      'iphone16': { width: 393, height: 852, deviceScaleFactor: 1 },
      'macbook-air': { width: 1440, height: 900, deviceScaleFactor: 1 },
    }
    return viewports[deviceType] || viewports['iphone16']
  }
}

export const playwrightService = new PlaywrightService()

