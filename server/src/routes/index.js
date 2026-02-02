import express from 'express'

const router = express.Router()

// Placeholder root API route
router.get('/', (req, res) => {
  res.json({ success: true, message: 'API root' })
})

export default router
