import fs from 'fs'
import path from 'path'

const HOURS = 60 * 60 * 1000

export const startCleanup = ({
  screenshotsDir = path.join(process.cwd(), 'screenshots'),
  uploadsDir = path.join(process.cwd(), 'uploads'),
  // IMPORTANT: default max age aligned with cache TTL (5 days)
  // Cache TTL: 5 * 24 * 60 * 60 seconds (see cache.js)
  // 5 days * 24 hours = 120 hours
  maxAgeHours = Number(process.env.CLEANUP_MAX_AGE_HOURS || 120),
  intervalMinutes = Number(process.env.CLEANUP_INTERVAL_MINUTES || 30)
} = {}) => {
  const maxAgeMs = maxAgeHours * HOURS
  const intervalMs = intervalMinutes * 60 * 1000

  const removeOldFiles = (dir) => {
    try {
      if (!fs.existsSync(dir)) return
      const now = Date.now()
      const files = fs.readdirSync(dir)
      files.forEach((file) => {
        const filePath = path.join(dir, file)
        try {
          const stat = fs.statSync(filePath)
          if (stat.isFile()) {
            const age = now - stat.mtimeMs
            if (age > maxAgeMs) {
              fs.unlinkSync(filePath)
            }
          }
        } catch (_) {}
      })
    } catch (_) {}
  }

  const run = () => {
    removeOldFiles(screenshotsDir)
    removeOldFiles(uploadsDir)
  }

  // Initial run and schedule
  run()
  const handle = setInterval(run, intervalMs)
  return () => clearInterval(handle)
}


