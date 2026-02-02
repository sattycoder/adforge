// Simple per-key concurrency limiter middleware
// Usage: limitConcurrency({ key: 'html', max: 1 })

const counters = new Map()

export const limitConcurrency = ({ key = 'default', max = 1 } = {}) => {
  return (req, res, next) => {
    const current = counters.get(key) || 0
    if (current >= max) {
      return res.status(429).json({
        success: false,
        message: 'Server is busy processing other requests. Please try again shortly.'
      })
    }

    counters.set(key, current + 1)

    const cleanup = () => {
      const now = counters.get(key) || 1
      counters.set(key, Math.max(0, now - 1))
    }

    res.on('finish', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)

    next()
  }
}


