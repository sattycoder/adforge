import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Ensure uploads directory exists
const uploadDir = 'uploads'
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const fileFilter = (req, file, cb) => {
  // Accept images, videos, HTML documents, and ZIP files
  const mime = file.mimetype || ''
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml'
  const isZip = mime === 'application/zip' || mime === 'application/x-zip-compressed' || 
                file.originalname.toLowerCase().endsWith('.zip')
  
  if (isImage || isVideo || isHtml || isZip) {
    cb(null, true)
  } else {
    cb(new Error('Only images, videos, HTML files, or ZIP files are allowed!'), false)
  }
}

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: fileFilter
})

export default upload
