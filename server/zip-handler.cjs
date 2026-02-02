#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const HtmlBundler = require('./bundle-html.cjs');
const HtmlConverter = require('./test-html-conversion.cjs');

/**
 * Enhanced ZIP File Handler
 * Handles ZIP file extraction and processing for asset uploads
 * - Detects image-only vs HTML+resources
 * - Maintains aspect ratios
 * - Supports: SVG, JS, CSS, PNG, JPG, GIF, WebP
 */
class ZipHandler {
  constructor() {
    this.tempDir = null;
    // Supported file types
    this.SUPPORTED_IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    this.SUPPORTED_RESOURCES = ['.css', '.js'];
    this.SUPPORTED_HTML = ['.html', '.htm'];
  }

  /**
   * Extract ZIP file to temporary directory
   * Filters out system files and metadata
   */
  async extractZip(zipPath, extractDir) {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        const extractedFiles = [];
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          // Skip system files
          if (entry.fileName.includes('__MACOSX') || 
              entry.fileName.startsWith('.') ||
              entry.fileName.includes('.DS_Store')) {
            zipfile.readEntry();
            return;
          }

          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            const dirPath = path.join(extractDir, entry.fileName);
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            zipfile.readEntry();
          } else {
            // File entry
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(err);
                return;
              }

              const filePath = path.join(extractDir, entry.fileName);
              const dirPath = path.dirname(filePath);
              
              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }

              const writeStream = fs.createWriteStream(filePath);
              readStream.pipe(writeStream);
              
              writeStream.on('close', () => {
                extractedFiles.push(filePath);
                zipfile.readEntry();
              });
              
              writeStream.on('error', reject);
            });
          }
        });

        zipfile.on('end', () => {
          resolve(extractedFiles);
        });

        zipfile.on('error', reject);
      });
    });
  }

  /**
   * Analyze extracted files to determine content type
   */
  analyzeZipContent(extractedFiles, extractDir) {
    const analysis = {
      hasHtml: false,
      htmlFile: null,
      images: [],
      css: [],
      js: [],
      svg: [],
      otherFiles: [],
      hasHype: false // Add HYPE detection flag
    };

    extractedFiles.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      const relPath = path.relative(extractDir, file);
      const fileName = path.basename(file).toLowerCase();

      if (this.SUPPORTED_HTML.includes(ext)) {
        analysis.hasHtml = true;
        if (!analysis.htmlFile) {
          analysis.htmlFile = file;
        }
      } else if (ext === '.svg') {
        analysis.svg.push(file);
      } else if (ext === '.css') {
        analysis.css.push(file);
      } else if (ext === '.js') {
        analysis.js.push(file);
        
        // Check if this is a HYPE file
        if (fileName.includes('hype') || fileName.includes('HYPE')) {
          analysis.hasHype = true;
        }
      } else if (this.SUPPORTED_IMAGES.includes(ext)) {
        analysis.images.push(file);
      } else {
        analysis.otherFiles.push(file);
      }
    });

    return analysis;
  }

  /**
   * Find the best HTML file to use
   */
  findMainHTMLFile(extractedFiles, extractDir) {
    const htmlFiles = extractedFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return (ext === '.html' || ext === '.htm') && 
             !file.toLowerCase().endsWith('.zip');
    });

    if (htmlFiles.length === 0) {
      return null;
    }

    // Priority: index.html at root > index.html nested > first HTML (sorted by depth)
    const rootIndex = htmlFiles.find(file => {
      const relPath = path.relative(extractDir, file);
      return path.basename(relPath).toLowerCase() === 'index.html' &&
             path.dirname(relPath) === '.';
    });
    if (rootIndex) return rootIndex;

    const nestedIndex = htmlFiles.find(file => {
      return path.basename(file).toLowerCase() === 'index.html';
    });
    if (nestedIndex) return nestedIndex;

    htmlFiles.sort((a, b) => {
      const relA = path.relative(extractDir, a);
      const relB = path.relative(extractDir, b);
      const depthA = relA.split(path.sep).length;
      const depthB = relB.split(path.sep).length;
      
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return relA.localeCompare(relB);
    });

    return htmlFiles[0];
  }

  /**
   * Normalize extraction structure
   * Moves nested files up if in single subdirectory
   */
  normalizeExtractionStructure(extractDir, extractedFiles) {
    const topLevelDirs = new Set();
    extractedFiles.forEach(file => {
      const relPath = path.relative(extractDir, file);
      const parts = relPath.split(path.sep).filter(p => p && p !== '__MACOSX');
      if (parts.length > 1) {
        topLevelDirs.add(parts[0]);
      }
    });

    if (topLevelDirs.size === 1) {
      const topDir = Array.from(topLevelDirs)[0];
      const topDirPath = path.join(extractDir, topDir);
      
      const htmlInTopDir = extractedFiles.some(file => {
        const relPath = path.relative(extractDir, file);
        const parts = relPath.split(path.sep);
        if (parts[0] === topDir) {
          const ext = path.extname(file).toLowerCase();
          return ext === '.html' || ext === '.htm';
        }
        return false;
      });

      if (htmlInTopDir && fs.existsSync(topDirPath)) {
        console.log(`📁 Normalizing structure: moving files from ${topDir}/ to root...`);
        
        const moveFiles = (dir) => {
          const entries = fs.readdirSync(dir);
          entries.forEach(entry => {
            if (entry === '__MACOSX' || entry.startsWith('.')) {
              return;
            }
            
            const src = path.join(dir, entry);
            const relPath = path.relative(topDirPath, src);
            const dest = path.join(extractDir, relPath);
            
            try {
              const stat = fs.statSync(src);
              if (stat.isDirectory()) {
                if (!fs.existsSync(dest)) {
                  fs.mkdirSync(dest, { recursive: true });
                }
                moveFiles(src);
                try {
                  fs.rmdirSync(src);
                } catch (e) {
                  // Ignore
                }
              } else {
                if (fs.existsSync(dest)) {
                  fs.unlinkSync(dest);
                }
                fs.renameSync(src, dest);
              }
            } catch (err) {
              console.warn(`⚠️ Could not move ${entry}:`, err.message);
            }
          });
        };
        
        moveFiles(topDirPath);
        
        try {
          fs.rmdirSync(topDirPath);
        } catch (err) {
          // Ignore
        }

        const updatedFiles = extractedFiles.map(file => {
          const relPath = path.relative(extractDir, file);
          const parts = relPath.split(path.sep);
          if (parts[0] === topDir) {
            const newPath = parts.slice(1).join(path.sep);
            return path.join(extractDir, newPath);
          }
          return file;
        }).filter(file => fs.existsSync(file));
        
        console.log(`✅ Normalized structure: ${updatedFiles.length} files`);
        return updatedFiles;
      }
    }

    return extractedFiles;
  }

  /**
   * Create wrapper HTML for image-only ZIPs with aspect ratio support
   */
  createImageWrapper(imagePath, dimensions = null) {
    const imageName = path.basename(imagePath);
    const imageExt = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };
    
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const mimeType = mimeTypes[imageExt] || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Calculate aspect ratio if dimensions provided
    let aspectRatioStyle = '';
    if (dimensions && dimensions.width && dimensions.height) {
      const aspectRatio = dimensions.height / dimensions.width;
      aspectRatioStyle = `aspect-ratio: ${dimensions.width} / ${dimensions.height};`;
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image Asset</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      overflow: hidden;
    }

    img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      ${aspectRatioStyle}
      object-fit: contain;
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${dataUrl}" alt="${imageName}" loading="lazy">
  </div>

  <script>
    // Ensure image scales properly to fit ad frame
    window.addEventListener('load', () => {
      const img = document.querySelector('img');
      if (img) {
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
      }
    });

    // Handle responsive sizing
    window.addEventListener('resize', () => {
      const img = document.querySelector('img');
      if (img) {
        const rect = img.parentElement.getBoundingClientRect();
        img.style.width = Math.min(img.naturalWidth, rect.width) + 'px';
        img.style.height = 'auto';
      }
    });
  </script>
</body>
</html>`;

    return htmlContent;
  }

  /**
   * Process ZIP file: extract, analyze, bundle, and convert
   * @param {string} zipPath - Path to ZIP file
   * @param {string} outputDir - Output directory
   * @param {Object} adFrameDimensions - Ad frame dimensions {width, height}
   */
  async processZipFile(zipPath, outputDir = './temp', adFrameDimensions = null) {
    try {
      console.log(`📦 Processing ZIP file: ${zipPath}`);
      
      const tempDir = path.join(outputDir, `temp_${Date.now()}`);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      this.tempDir = tempDir;
      
      // Extract ZIP
      console.log('📤 Extracting ZIP file...');
      let extractedFiles = await this.extractZip(zipPath, tempDir);
      console.log(`✅ Extracted ${extractedFiles.length} files`);
      
      // Normalize structure
      console.log('🔄 Normalizing extraction structure...');
      extractedFiles = this.normalizeExtractionStructure(tempDir, extractedFiles);
      
      // Analyze content
      const analysis = this.analyzeZipContent(extractedFiles, tempDir);
      console.log(`📊 Content analysis: HTML=${analysis.hasHtml}, Images=${analysis.images.length}, CSS=${analysis.css.length}, JS=${analysis.js.length}, SVG=${analysis.svg.length}, HYPE=${analysis.hasHype}`);
      
      let htmlPath;

      if (analysis.hasHtml) {
        // HTML with supporting files
        console.log('📄 HTML with resources detected');
        
        const bundler = new HtmlBundler(tempDir, outputDir);
        htmlPath = await bundler.run(adFrameDimensions);
        console.log(`✅ Bundled HTML: ${htmlPath}`);
        
        // Get temp path for Playwright (has access to images)
        const tempBundledPath = bundler.getTempBundledPath();
        this.tempBundledPath = tempBundledPath; // Store for Playwright captures

      } else if (analysis.images.length > 0) {
        // Image-only ZIP - use image directly without conversion
        console.log(`📷 [ZIP-HANDLER] Image-only ZIP detected (${analysis.images.length} images)`);
        
        const firstImage = analysis.images[0];
        console.log(`   Using primary image: ${path.basename(firstImage)}`);
        
        // Extract image dimensions
        let assetDimensions = null;
        try {
          const imageSize = require('image-size');
          assetDimensions = imageSize(firstImage);
          console.log(`📐 [ZIP-HANDLER] Image dimensions: ${assetDimensions.width}x${assetDimensions.height}`);
        } catch (err) {
          console.warn(`⚠️ [ZIP-HANDLER] Could not extract dimensions: ${err.message}`);
        }
        
        // Copy image directly to output (no HTML wrapper, no conversion)
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const imageExt = path.extname(firstImage);
        const outputImageName = `image_${ts}${imageExt}`;
        const outputImagePath = path.join(outputDir, outputImageName);
        fs.copyFileSync(firstImage, outputImagePath);
        console.log(`📁 [ZIP-HANDLER] Copied image directly: ${path.basename(outputImagePath)}`);
        
        // Determine image type
        const imageType = imageExt.toLowerCase() === '.gif' ? 'gif' : 'image';
        
        // Cleanup temp directory
        this.cleanup();
        
        const result = {
          success: true,
          bundledHtml: null,
          thumbnail: null, // No separate thumbnail - image IS the asset
          convertedAsset: outputImagePath,
          hasAnimations: false,
          assetType: imageType,
          contentType: 'image',
          dimensions: assetDimensions,
          adFrameDimensions: adFrameDimensions,
          isDirectImage: true
        };
        
        console.log('✅ [ZIP-HANDLER] Single image processing complete!');
        console.log(`   📦 Content type: image`);
        console.log(`   🎬 Asset type: ${imageType}`);
        console.log(`   🖼️  Direct image: YES (no conversion)`);
        if (assetDimensions) {
          const ratio = (assetDimensions.width / assetDimensions.height).toFixed(3);
          console.log(`   📐 Image: ${assetDimensions.width}x${assetDimensions.height} (ratio: ${ratio})`);
        }
        if (adFrameDimensions) {
          const ratio = (adFrameDimensions.width / adFrameDimensions.height).toFixed(3);
          console.log(`   🎯 Frame: ${adFrameDimensions.width}x${adFrameDimensions.height} (ratio: ${ratio})`);
        }
        
        console.log('RESULT:' + JSON.stringify(result));
        return result;

      } else {
        throw new Error('No HTML files or images found in ZIP');
      }

      // === HTML-based ZIP processing below ===
      // CRITICAL: Use temp bundled HTML (with images) for Playwright captures
      const captureHtmlPath = this.tempBundledPath || htmlPath;
      const hasHype = analysis.hasHype;
      
      // Convert to video/image (no thumbnail needed - video will be used directly)
      console.log('🎬 Converting to video/image...');
      const converter = new HtmlConverter();
      await converter.init();
      converter.setHypeMode(hasHype); // Tell converter if HYPE detection is needed
      
      const conversionResult = await converter.convertHtmlFile(captureHtmlPath, outputDir);
      await converter.cleanup();
      
      if (!conversionResult.success) {
        throw new Error(`Conversion failed: ${conversionResult.error}`);
      }
      
      console.log(`✅ Conversion result: ${conversionResult.outputPath}`);

      // Cleanup
      this.cleanup();
      
      const result = {
        success: true,
        bundledHtml: htmlPath,
        thumbnail: null, // No thumbnail - video will be used directly for screenshots
        convertedAsset: conversionResult.outputPath,
        hasAnimations: conversionResult.hasAnimations,
        assetType: conversionResult.hasAnimations ? 'video' : 'image',
        contentType: analysis.hasHtml ? 'html' : 'image',
        dimensions: null,
        adFrameDimensions: adFrameDimensions,
        isDirectImage: false
      };
      
      console.log('RESULT:' + JSON.stringify(result));
      return result;
      
    } catch (error) {
      console.error('❌ ZIP processing failed:', error);
      this.cleanup();
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up temporary files
   */
  cleanup() {
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary files');
      } catch (error) {
        console.warn('⚠️ Could not clean up temporary files:', error.message);
      }
    }
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node zip-handler.js <zip-file> [output-directory]');
    console.log('Example: node zip-handler.js assets.zip ./output');
    process.exit(1);
  }

  const zipPath = args[0];
  const outputDir = args[1] || './zip-output';

  async function main() {
    const handler = new ZipHandler();
    
    try {
      const result = await handler.processZipFile(zipPath, outputDir);
      
      if (result.success) {
        console.log('\n🎉 ZIP processing completed successfully!');
        console.log(`📄 Bundled HTML: ${result.bundledHtml}`);
        console.log(`🖼️ Thumbnail: ${result.thumbnail}`);
        console.log(`🎬 Converted Asset: ${result.convertedAsset}`);
        console.log(`🎭 Has Animations: ${result.hasAnimations}`);
        console.log(`📊 Asset Type: ${result.assetType}`);
      } else {
        console.error('❌ ZIP processing failed:', result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    }
  }

  main();
}

module.exports = ZipHandler;
