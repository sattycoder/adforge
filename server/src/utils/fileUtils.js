import fs from 'fs'
import path from 'path'

// File utility functions

export const fileUtils = {
  // Ensure directory exists
  ensureDir: (dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  },

  // Get file extension
  getFileExtension: (filename) => {
    return path.extname(filename).toLowerCase()
  },

  // Check if file is image
  isImageFile: (filename) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    const ext = fileUtils.getFileExtension(filename)
    return imageExtensions.includes(ext)
  },

  // Generate unique filename
  generateUniqueFilename: (originalName) => {
    const ext = path.extname(originalName)
    const name = path.basename(originalName, ext)
    const timestamp = Date.now()
    const random = Math.round(Math.random() * 1E9)
    return `${name}-${timestamp}-${random}${ext}`
  },

  // Delete file
  deleteFile: (filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        return true
      }
      return false
    } catch (error) {
      console.error('Error deleting file:', error)
      return false
    }
  },

  // Get file size
  getFileSize: (filePath) => {
    try {
      const stats = fs.statSync(filePath)
      return stats.size
    } catch (error) {
      console.error('Error getting file size:', error)
      return 0
    }
  }
}
