import express from 'express'
import cors from 'cors'
import path from 'path'
import routes from './routes/index.js'
import pageRoutes from './routes/pageRoutes.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'

const app = express()

// Middleware
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Serve static files from persistent volumes
app.use('/screenshots', express.static(path.join(process.cwd(), 'screenshots')))
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))
app.use('/output-ss-files', express.static(path.join(process.cwd(), 'output-ss-files')))

// In production, serve client build
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(process.cwd(), '..', 'client', 'dist')
  app.use(express.static(clientBuild))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientBuild, 'index.html'))
  })
}

// Routes
app.use('/api', routes)
app.use('/api/pages', pageRoutes)

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Ad Maker API is running' })
})

// 404 handler
app.use(notFound)

// Error handling middleware
app.use(errorHandler)

export default app
