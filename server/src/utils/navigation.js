export const gotoWithRetries = async (page, url, opts = {}) => {
  const attempts = opts.attempts || 3
  const waits = ['domcontentloaded', 'networkidle', 'load']
  for (let i = 0; i < attempts; i++) {
    for (const waitUntil of waits) {
      try {
        await page.goto(url, { waitUntil, timeout: 90000 })
        return
      } catch (e) {
        if (i === attempts - 1 && waitUntil === waits[waits.length - 1]) throw e
      }
    }
  }
}



