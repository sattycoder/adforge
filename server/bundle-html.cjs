#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * HTML Bundler Script
 * Bundles HTML, CSS, JS, and image assets into a single HTML file
 */

class HtmlBundler {
  constructor(inputDir, outputDir = './output') {
    this.inputDir = path.resolve(inputDir);
    this.outputDir = path.resolve(outputDir);
    this.bundledHtml = '';
  }

  /**
   * Ensure output directory exists
   */
  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Get all files recursively from directory
   */
  getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        this.getAllFiles(filePath, fileList);
      } else {
        fileList.push(filePath);
      }
    });
    
    return fileList;
  }

  /**
   * Convert file to base64 data URL
   */
  fileToDataUrl(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.html': 'text/html',
      '.htm': 'text/html'
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const fileContent = fs.readFileSync(filePath);
    const base64 = fileContent.toString('base64');
    
    return `data:${mimeType};base64,${base64}`;
  }

  /**
   * Process and inline CSS files
   */
  processCSS(cssContent, cssDir) {
    // Handle @import statements
    let processedCSS = cssContent.replace(/@import\s+['"]([^'"]+)['"];?/g, (match, importPath) => {
      const fullPath = path.resolve(cssDir, importPath);
      if (fs.existsSync(fullPath)) {
        const importedCSS = fs.readFileSync(fullPath, 'utf8');
        return this.processCSS(importedCSS, path.dirname(fullPath));
      }
      return match;
    });

    // Handle url() references in CSS
    processedCSS = processedCSS.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, urlPath) => {
      const fullPath = path.resolve(cssDir, urlPath);
      if (fs.existsSync(fullPath)) {
        const dataUrl = this.fileToDataUrl(fullPath);
        return `url('${dataUrl}')`;
      }
      return match;
    });

    return processedCSS;
  }

  /**
   * Process and inline JavaScript files
   */
  processJS(jsContent, jsDir) {
    // Handle import statements (basic support)
    let processedJS = jsContent.replace(/import\s+['"]([^'"]+)['"];?/g, (match, importPath) => {
      const fullPath = path.resolve(jsDir, importPath);
      if (fs.existsSync(fullPath)) {
        const importedJS = fs.readFileSync(fullPath, 'utf8');
        return this.processJS(importedJS, path.dirname(fullPath));
      }
      return match;
    });

    return processedJS;
  }

  /**
   * Find the main HTML file
   */
  findMainHTML() {
    const files = this.getAllFiles(this.inputDir);
    const htmlFiles = files.filter(file => 
      path.extname(file).toLowerCase() === '.html' || 
      path.extname(file).toLowerCase() === '.htm'
    );

    if (htmlFiles.length === 0) {
      throw new Error('No HTML files found in the input directory');
    }

    // Prefer index.html, otherwise use the first HTML file
    const indexFile = htmlFiles.find(file => 
      path.basename(file).toLowerCase() === 'index.html'
    );

    return indexFile || htmlFiles[0];
  }

  /**
   * Bundle all assets into a single HTML file
   * @param {Object} adFrameDimensions - Target ad frame dimensions {width, height}
   */
  async bundleAssets(adFrameDimensions = null) {
    console.log(`🔄 [HTML-BUNDLER] Bundling assets from: ${path.basename(this.inputDir)}`);
    
    // Find main HTML file
    const mainHtmlPath = this.findMainHTML();
    console.log(`📄 [HTML-BUNDLER] Main HTML file: ${path.basename(mainHtmlPath)}`);

    let htmlContent = fs.readFileSync(mainHtmlPath, 'utf8');
    const htmlDir = path.dirname(mainHtmlPath);

    // Process CSS files
    const cssFiles = this.getAllFiles(this.inputDir).filter(file => 
      path.extname(file).toLowerCase() === '.css'
    );

    console.log(`🎨 [HTML-BUNDLER] Processing ${cssFiles.length} CSS files...`);
    
    // Track which CSS files were inlined via <link> replacement
    const inlinedCssFiles = new Set();
    
    // Step 1: Find and replace <link rel="stylesheet" href="..."> tags
    const linkCssRegex = /<link([^>]*)\s+href=["']([^"']+)["']([^>]*)>/gi;
    let cssReplacementCount = 0;
    
    // Use replace with callback to handle all occurrences
    htmlContent = htmlContent.replace(linkCssRegex, (fullTag, before, hrefValue, after) => {
      // Only process if it's a stylesheet link
      if (fullTag.includes('stylesheet')) {
        const cleanHrefPath = hrefValue.split('?')[0];
        console.log(`   🔍 Found <link stylesheet href="${hrefValue}">`);
        
        // Find the CSS file
        let foundCssFile = null;
        for (const cssFile of cssFiles) {
          const relativePath = path.relative(htmlDir, cssFile).replace(/\\/g, '/');
          const fileName = path.basename(cssFile);
          
          if (relativePath === cleanHrefPath || 
              relativePath === hrefValue ||
              fileName === path.basename(cleanHrefPath) ||
              relativePath.endsWith(cleanHrefPath)) {
            foundCssFile = cssFile;
            break;
          }
        }
        
        if (foundCssFile) {
          const cssContent = fs.readFileSync(foundCssFile, 'utf8');
          const processedCSS = this.processCSS(cssContent, path.dirname(foundCssFile));
          
          // Replace <link> with <style>
          const styleTag = `<style type="text/css">\n${processedCSS}\n</style>`;
          
          inlinedCssFiles.add(foundCssFile);
          cssReplacementCount++;
          console.log(`   ✅ Inlined: ${path.basename(foundCssFile)}`);
          
          return styleTag;
        } else {
          console.warn(`   ⚠️ Could not find CSS file for: ${hrefValue}`);
        }
      }
      
      return fullTag; // Keep original if not stylesheet or file not found
    });
    
    console.log(`   📦 Inlined ${cssReplacementCount} <link stylesheet> tag(s)`);
    
    // Step 2: Append any remaining CSS files that weren't referenced
    const remainingCssFiles = cssFiles.filter(file => !inlinedCssFiles.has(file));
    
    if (remainingCssFiles.length > 0) {
      console.log(`   📎 Appending ${remainingCssFiles.length} unreferenced CSS file(s) to </head>`);
      for (const cssFile of remainingCssFiles) {
        const cssContent = fs.readFileSync(cssFile, 'utf8');
        const processedCSS = this.processCSS(cssContent, path.dirname(cssFile));
        
        const styleTag = `<style type="text/css">\n${processedCSS}\n</style>`;
        htmlContent = htmlContent.replace('</head>', `${styleTag}\n</head>`);
        console.log(`   ✅ Appended: ${path.basename(cssFile)}`);
      }
    }

    // Process JavaScript files
    // First, inline <script src="..."> tags that are referenced in the HTML
    const jsFiles = this.getAllFiles(this.inputDir).filter(file => 
      path.extname(file).toLowerCase() === '.js'
    );
    
    console.log(`📜 [HTML-BUNDLER] Processing ${jsFiles.length} JavaScript files...`);
    
    // NOTE: We no longer inline JavaScript files because:
    // 1. Inlining can break syntax in complex scripts (minified code, template literals, etc.)
    // 2. Playwright loads via file:// URLs, so relative paths work perfectly
    // 3. Scripts are accessible from the temp directory during capture
    console.log(`   ℹ️  JavaScript will be loaded via <script src> (not inlined)`);

    // Process image references in HTML
    const imageFiles = this.getAllFiles(this.inputDir).filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);
    });

    console.log(`🖼️  [HTML-BUNDLER] Processing ${imageFiles.length} image files...`);
    // NOTE: We no longer inline images as data URIs because:
    // 1. It breaks JavaScript syntax when replacing paths in JS code
    // 2. Playwright loads via file:// URLs, so relative paths work perfectly
    // 3. Images are accessible from the temp directory during capture
    console.log(`   ℹ️  Images will be loaded via relative paths (not inlined)`);

    // Add metadata and responsive styles
    let metadataBlock = `<head>\n<!-- Bundled by Html Bundler -->\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">`;
    
    // Add aspect ratio preservation styles if ad frame dimensions provided
    if (adFrameDimensions && adFrameDimensions.width && adFrameDimensions.height) {
      const aspectRatio = adFrameDimensions.width / adFrameDimensions.height;
      console.log(`   📐 [HTML-BUNDLER] Adding aspect ratio styles for ${adFrameDimensions.width}x${adFrameDimensions.height} (ratio: ${aspectRatio.toFixed(3)})`);
      
      metadataBlock += `\n<style>
  /* Aspect Ratio Preservation */
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  body {
    display: flex;
    justify-content: center;
    align-items: center;
  }
  body > * {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>`;
    }
    
    htmlContent = htmlContent.replace('<head>', metadataBlock);

    this.bundledHtml = htmlContent;
    console.log('✅ [HTML-BUNDLER] Assets bundled successfully');
  }

  /**
   * Save bundled HTML to file
   */
  saveBundledHTML() {
    // Save to outputDir for final result
    const outputPath = path.join(this.outputDir, 'bundled.html');
    fs.writeFileSync(outputPath, this.bundledHtml, 'utf8');
    console.log(`💾 [HTML-BUNDLER] Bundled HTML saved to: ${path.basename(outputPath)}`);
    
    // ALSO save to inputDir (temp dir) so Playwright can access images!
    const tempPath = path.join(this.inputDir, 'bundled.html');
    fs.writeFileSync(tempPath, this.bundledHtml, 'utf8');
    console.log(`💾 [HTML-BUNDLER] Copy saved to temp dir for Playwright capture`);
    
    return outputPath; // Return outputDir version for final result
  }
  
  /**
   * Get path to temp bundled HTML (for Playwright)
   */
  getTempBundledPath() {
    return path.join(this.inputDir, 'bundled.html');
  }

  /**
   * Main bundling process
   * @param {Object} adFrameDimensions - Target ad frame dimensions {width, height}
   */
  async run(adFrameDimensions = null) {
    try {
      console.log('🚀 [HTML-BUNDLER] Starting HTML bundling...');
      if (adFrameDimensions) {
        console.log(`   🎯 Target ad frame: ${adFrameDimensions.width}x${adFrameDimensions.height}px`);
      }
      
      if (!fs.existsSync(this.inputDir)) {
        throw new Error(`Input directory not found: ${this.inputDir}`);
      }

      this.ensureOutputDir();
      await this.bundleAssets(adFrameDimensions);
      const htmlPath = this.saveBundledHTML();
      
      console.log(`✅ [HTML-BUNDLER] Bundling complete: ${path.basename(htmlPath)}`);
      return htmlPath;
    } catch (error) {
      console.error('❌ [HTML-BUNDLER] Error during bundling:', error.message);
      throw error;
    }
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node bundle-html.js <input-directory> [output-directory]');
    process.exit(1);
  }

  const inputDir = args[0];
  const outputDir = args[1] || './output';
  
  const bundler = new HtmlBundler(inputDir, outputDir);
  bundler.run();
}

module.exports = HtmlBundler;
