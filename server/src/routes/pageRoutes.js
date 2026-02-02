import express from 'express'
import pageController from '../controllers/pageController.js'
import adController from '../controllers/adController.js'
import upload from '../middleware/upload.js'
import { singleFlight } from '../middleware/singleFlight.js'
import { clearUserCache } from '../utils/cache.js'
import { browserPool } from '../utils/browserPool.js'
import { getQueueStats } from '../utils/pageQueue.js'
import path from 'path'
import fs from 'fs'
import { limitConcurrency } from '../middleware/concurrency.js'

const router = express.Router()

// Page rendering and ad detection routes
router.get('/renderPage', singleFlight(), pageController.renderPage)
router.get('/jobStatus', pageController.getJobStatus)
router.get('/pageInfo', pageController.getPageInfo)

// Health and monitoring endpoint
router.get('/health', async (req, res) => {
  try {
    const poolStats = browserPool.getStats()
    const queueStats = await getQueueStats()
    
    res.json({
      success: true,
      data: {
        browserPool: {
          totalContexts: poolStats.totalContexts,
          activeContexts: poolStats.activeContexts,
          availableContexts: poolStats.availableContexts,
          queueLength: poolStats.queueLength,
          totalAllocations: poolStats.totalAllocations,
          totalReleases: poolStats.totalReleases,
          maxWaitTime: poolStats.maxWaitTime,
          averageWaitTime: Math.round(poolStats.averageWaitTime),
        },
        queue: {
          waiting: queueStats.waiting,
          active: queueStats.active,
          completed: queueStats.completed,
          failed: queueStats.failed,
          total: queueStats.total,
        },
        status: poolStats.availableContexts > 0 ? 'healthy' : 'busy',
        timestamp: new Date().toISOString(),
      }
    })
  } catch (error) {
    console.error('Error getting health stats:', error)
    res.status(500).json({
      success: false,
      message: 'Error getting health stats',
      error: error.message
    })
  }
})

// Cache management routes
router.post('/purgeCache', async (req, res) => {
  try {
    const { userEmail } = req.body
    
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      })
    }
    
    await clearUserCache(userEmail)
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    })
  } catch (error) {
    console.error('Error purging cache:', error)
    res.status(500).json({
      success: false,
      message: 'Error purging cache',
      error: error.message
    })
  }
})

// Ad injection and management routes
router.post('/injectAd', singleFlight(), adController.injectAd)
router.post('/uploadAd', upload.single('image'), adController.uploadAdImage)
router.post('/uploadAsset', upload.single('asset'), adController.uploadAsset)
// Limit heavy playwright-based operations to avoid memory saturation
router.post('/generateHtmlThumbnail', limitConcurrency({ key: 'heavy-html', max: 1 }), adController.generateHtmlThumbnail)
router.post('/generatePreview', adController.generatePreview)

// ZIP and HTML processing routes
router.post('/processZipAsset', limitConcurrency({ key: 'heavy-zip', max: 1 }), upload.single('zip'), adController.processZipAsset)
router.post('/processHtmlAsset', limitConcurrency({ key: 'heavy-html', max: 1 }), upload.single('html'), adController.processHtmlAsset)

// File download routes
router.get('/download/:fileName', (req, res) => {
  try {
    const { fileName } = req.params
    const { type = 'screenshots' } = req.query // type can be 'screenshots' or 'uploads'
    
    // Security check - prevent directory traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      })
    }
    
    const publicDir = path.join(process.cwd(), 'public', type)
    const filePath = path.join(publicDir, fileName)
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      })
    }
    
    // Set appropriate headers
    const ext = path.extname(fileName).toLowerCase()
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.html': 'text/html'
    }
    
    const mimeType = mimeTypes[ext] || 'application/octet-stream'
    
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error)
      res.status(500).json({
        success: false,
        message: 'Error downloading file'
      })
    })
    
  } catch (error) {
    console.error('Error handling download:', error)
    res.status(500).json({
      success: false,
      message: 'Error downloading file',
      error: error.message
    })
  }
})

// List available files
router.get('/files', (req, res) => {
  try {
    const { type = 'screenshots' } = req.query
    const publicDir = path.join(process.cwd(), 'public', type)
    
    if (!fs.existsSync(publicDir)) {
      return res.json({
        success: true,
        data: {
          files: [],
          type
        }
      })
    }
    
    const files = fs.readdirSync(publicDir)
      .filter(file => {
        const filePath = path.join(publicDir, file)
        return fs.statSync(filePath).isFile()
      })
      .map(file => {
        const filePath = path.join(publicDir, file)
        const stats = fs.statSync(filePath)
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          url: `/${type}/${file}`
        }
      })
      .sort((a, b) => b.modified - a.modified) // Sort by most recent first
    
    res.json({
      success: true,
      data: {
        files,
        type,
        count: files.length
      }
    })
    
  } catch (error) {
    console.error('Error listing files:', error)
    res.status(500).json({
      success: false,
      message: 'Error listing files',
      error: error.message
    })
  }
})

export default router
