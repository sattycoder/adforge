import { playwrightService } from '../utils/playwright.js'
import { fileUtils } from '../utils/fileUtils.js'
import { sleep } from '../utils/sleep.js'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createRequire } from 'module'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// Ad Controller - Handles ad injection and screenshot generation

export default {
  // Inject is intentionally disabled; use client overlay or future compose endpoint
  injectAd: async (req, res) => {
    return res.status(501).json({ success: false, message: 'Server-side ad injection disabled. Overlay client-side or use compose API.' })
  },

  // Generate a PNG thumbnail for an uploaded HTML asset sized to provided dimensions
  generateHtmlThumbnail: async (req, res) => {
    try {
      const { url, width, height } = req.body || {}
      if (!url || !width || !height) {
        return res.status(400).json({ success: false, message: 'url, width and height are required' })
      }

      // Resolve local file path if served from /uploads
      let localPath
      if (url.startsWith('/uploads/')) {
        localPath = path.join(process.cwd(), url)
      } else {
        // Fallback: try to interpret as filesystem path
        localPath = path.isAbsolute(url) ? url : path.join(process.cwd(), url)
      }

      if (!fs.existsSync(localPath)) {
        return res.status(404).json({ success: false, message: 'HTML asset not found' })
      }

      const page = await playwrightService.getPage()
      try {
        await page.setViewportSize({ width: Number(width), height: Number(height) })
        const fileUrl = 'file://' + localPath
        await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 100000 })
        const buffer = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: Number(width), height: Number(height) }
        })

        const publicDir = path.join(process.cwd(), 'uploads')
        fileUtils.ensureDir(publicDir)
        const thumbName = `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
        const thumbPath = path.join(publicDir, thumbName)
        fs.writeFileSync(thumbPath, buffer)

        return res.json({ success: true, data: { thumbnailUrl: `/uploads/${thumbName}` } })
      } finally {
        await page.close()
      }
    } catch (error) {
      console.error('Error generating HTML thumbnail:', error)
      return res.status(500).json({ success: false, message: 'Error generating HTML thumbnail', error: error.message })
    }
  },

  // Upload ad image
  uploadAdImage: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided'
        })
      }

      const file = req.file
      
      // Validate file type
      if (!fileUtils.isImageFile(file.originalname)) {
        return res.status(400).json({
          success: false,
          message: 'Only image files are allowed'
        })
      }

      // Move file to uploads directory for frontend access
      const publicDir = path.join(process.cwd(), 'uploads')
      fileUtils.ensureDir(publicDir)
      
      const publicFilename = `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`
      const publicPath = path.join(publicDir, publicFilename)
      
      fs.copyFileSync(file.path, publicPath)
      
      // Clean up temporary file
      fs.unlinkSync(file.path)

      res.json({
        success: true,
        message: 'Ad image uploaded successfully',
        data: {
          filename: publicFilename,
          imageUrl: `/uploads/${publicFilename}`,
          size: file.size,
          originalName: file.originalname
        }
      })

    } catch (error) {
      console.error('Error uploading ad image:', error)
      res.status(500).json({
        success: false,
        message: 'Error uploading ad image',
        error: error.message
      })
    }
  },

  // Upload generic creative asset (image, video, html)
  uploadAsset: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file provided' })
      }

      const file = req.file
      const mime = file.mimetype || ''

      const publicDir = path.join(process.cwd(), 'uploads')
      fileUtils.ensureDir(publicDir)

      const publicFilename = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`
      const publicPath = path.join(publicDir, publicFilename)
      fs.copyFileSync(file.path, publicPath)
      fs.unlinkSync(file.path)

      return res.json({
        success: true,
        message: 'Asset uploaded successfully',
        data: {
          filename: publicFilename,
          url: `/uploads/${publicFilename}`,
          size: file.size,
          originalName: file.originalname,
          mimeType: mime,
        },
      })
    } catch (error) {
      console.error('Error uploading asset:', error)
      return res.status(500).json({ success: false, message: 'Error uploading asset', error: error.message })
    }
  },

  // Generate preview with injected ad
  generatePreview: async (req, res) => {
    try {
      const { url, device, slotId, imageUrl } = req.body
      
      if (!url || !device) {
        return res.status(400).json({
          success: false,
          message: 'URL and device are required'
        })
      }

      const page = await playwrightService.getPage()
      
      try {
        const viewport = playwrightService.getViewportForDevice(device)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        })

        // If slotId and imageUrl provided, inject the ad
        if (slotId && imageUrl) {
          await page.evaluate((slotId, imageUrl) => {
            const element = document.querySelector(`[data-slot-id="${slotId}"]`) || 
                           document.querySelector(`#${slotId}`) ||
                           document.querySelector(`.${slotId}`)
            
            if (element) {
              element.innerHTML = ''
              const img = document.createElement('img')
              img.src = imageUrl
              img.style.width = '100%'
              img.style.height = '100%'
              img.style.objectFit = 'cover'
              img.style.display = 'block'
              element.appendChild(img)
              element.setAttribute('data-ad-injected', 'true')
            }
          }, slotId, imageUrl)
        }

        // Generate screenshot
        const screenshot = await page.screenshot({
          fullPage: true,
          type: 'png'
        })

        // Save screenshot to persistent volume
        const screenshotsDir = path.join(process.cwd(), 'screenshots')
        fileUtils.ensureDir(screenshotsDir)
        
        const screenshotFilename = `preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.png`
        const screenshotPath = path.join(screenshotsDir, screenshotFilename)
        
        fs.writeFileSync(screenshotPath, screenshot)

        res.json({
          success: true,
          message: 'Preview generated successfully',
          data: {
            previewUrl: `/screenshots/${screenshotFilename}`,
            url,
            device,
            timestamp: new Date().toISOString()
          }
        })

      } finally {
        await page.close()
      }

    } catch (error) {
      console.error('Error generating preview:', error)
      res.status(500).json({
        success: false,
        message: 'Error generating preview',
        error: error.message
      })
    }
  },

  // Process ZIP file: extract, bundle, and convert
  processZipAsset: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No ZIP file provided' })
      }

      const zipPath = req.file.path
      const outputDir = path.join(process.cwd(), 'uploads', 'processed')
      fileUtils.ensureDir(outputDir)

      // Extract ad frame dimensions from request body
      const adFrameWidth = req.body.adFrameWidth ? parseInt(req.body.adFrameWidth) : null
      const adFrameHeight = req.body.adFrameHeight ? parseInt(req.body.adFrameHeight) : null
      let adFrameDimensions = null
      
      if (adFrameWidth && adFrameHeight && !isNaN(adFrameWidth) && !isNaN(adFrameHeight)) {
        adFrameDimensions = { width: adFrameWidth, height: adFrameHeight }
        console.log(`📦 [AD-CONTROLLER] Processing ZIP file: ${path.basename(zipPath)}`)
        console.log(`   🎯 Ad frame dimensions provided: ${adFrameWidth}x${adFrameHeight}px`)
      } else {
        console.log(`📦 [AD-CONTROLLER] Processing ZIP file: ${path.basename(zipPath)} (no frame dimensions provided)`)
      }

      // Load and use ZipHandler class directly (better approach than CLI)
      const ZipHandler = require(path.join(process.cwd(), 'zip-handler.cjs'))
      const handler = new ZipHandler()
      
      const result = await handler.processZipFile(zipPath, outputDir, adFrameDimensions)
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'ZIP processing failed',
          error: result.error
        })
      }

      console.log(`✅ [AD-CONTROLLER] ZIP processing complete`)

      // Convert absolute paths to relative URLs
      const convertedAssetUrl = result.convertedAsset.replace(process.cwd(), '')
      const thumbnailUrl = result.thumbnail ? result.thumbnail.replace(process.cwd(), '') : null

      res.json({
        success: true,
        data: {
          url: convertedAssetUrl,
          thumbnailUrl: thumbnailUrl,
          type: result.assetType,
          hasAnimations: result.hasAnimations,
          bundledHtml: result.bundledHtml ? result.bundledHtml.replace(process.cwd(), '') : null,
          dimensions: result.dimensions,
          adFrameDimensions: result.adFrameDimensions,
          isDirectImage: result.isDirectImage || false,
          contentType: result.contentType
        }
      })

    } catch (error) {
      console.error('Error processing ZIP:', error)
      res.status(500).json({
        success: false,
        message: 'Error processing ZIP file',
        error: error.message
      })
    }
  },

  // Process HTML file directly
  processHtmlAsset: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No HTML file provided' })
      }

      const htmlPath = req.file.path
      const outputDir = path.join(process.cwd(), 'uploads', 'processed')
      fileUtils.ensureDir(outputDir)

      console.log(`📄 Processing HTML file: ${htmlPath}`)

      // Use html-handler.cjs to process HTML
      const scriptPath = path.join(process.cwd(), 'html-handler.cjs')
      const command = `node ${scriptPath} "${htmlPath}" "${outputDir}"`

      const { stdout, stderr } = await execAsync(command)
      
      if (stderr) {
        console.error('HTML processing stderr:', stderr)
      }

      console.log('HTML processing output:', stdout)

      // Parse the result from stdout
      let result
      try {
        const lines = stdout.trim().split('\n')
        const resultLine = lines.find(line => line.startsWith('RESULT:'))
        if (resultLine) {
          result = JSON.parse(resultLine.replace('RESULT:', ''))
        } else {
          throw new Error('No result found in output')
        }
      } catch (parseError) {
        console.error('Error parsing result:', parseError)
        return res.status(500).json({
          success: false,
          message: 'Error processing HTML file',
          error: parseError.message
        })
      }

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'HTML processing failed',
          error: result.error
        })
      }

      // Convert absolute paths to relative URLs
      const convertedAssetUrl = result.convertedAsset.replace(process.cwd(), '')
      const thumbnailUrl = result.thumbnail.replace(process.cwd(), '')

      res.json({
        success: true,
        data: {
          url: convertedAssetUrl,
          thumbnailUrl: thumbnailUrl,
          type: result.assetType,
          hasAnimations: result.hasAnimations
        }
      })

    } catch (error) {
      console.error('Error processing HTML:', error)
      res.status(500).json({
        success: false,
        message: 'Error processing HTML file',
        error: error.message
      })
    }
  }
}
