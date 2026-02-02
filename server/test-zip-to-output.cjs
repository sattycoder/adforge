#!/usr/bin/env node

/**
 * Standalone ZIP to Video/Image Test Script
 * 
 * Usage:
 *   node test-zip-to-output.cjs <path-to-zip-file>
 * 
 * Example:
 *   node test-zip-to-output.cjs ./Zip-Dateien/my-banner.zip
 * 
 * Output:
 *   - MP4 video for dynamic HTML ZIPs → server/output/
 *   - PNG for static HTML ZIPs → server/output/
 *   - Direct image for single-image ZIPs → server/output/
 */

const fs = require('fs');
const path = require('path');
const ZipHandler = require('./zip-handler.cjs');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(emoji, message, color = colors.reset) {
  console.log(`${color}${emoji} ${message}${colors.reset}`);
}

async function testZipProcessing(zipPath) {
  const outputDir = path.join(__dirname, 'output');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  log('🎯', `Testing ZIP: ${path.basename(zipPath)}`, colors.bright);
  log('📁', `Output directory: ${outputDir}`, colors.cyan);
  console.log('');
  
  // Validate ZIP file exists
  if (!fs.existsSync(zipPath)) {
    log('❌', `ZIP file not found: ${zipPath}`, colors.red);
    process.exit(1);
  }
  
  const startTime = Date.now();
  
  try {
    // Process the ZIP
    const handler = new ZipHandler();
    const result = await handler.processZipFile(zipPath, outputDir);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (!result.success) {
      log('❌', `Processing failed: ${result.error}`, colors.red);
      process.exit(1);
    }
    
    console.log('');
    log('✅', 'Processing completed successfully!', colors.green);
    log('⏱️', `Duration: ${duration}s`, colors.cyan);
    console.log('');
    
    // Display results
    console.log(`${colors.bright}📊 Results:${colors.reset}`);
    console.log(`  ${colors.cyan}Content Type:${colors.reset} ${result.contentType}`);
    console.log(`  ${colors.cyan}Asset Type:${colors.reset} ${result.assetType}`);
    console.log(`  ${colors.cyan}Has Animations:${colors.reset} ${result.hasAnimations ? 'Yes' : 'No'}`);
    
    if (result.isDirectImage) {
      console.log(`  ${colors.green}Direct Image:${colors.reset} YES (no conversion applied)`);
    }
    
    if (result.dimensions) {
      const ratio = (result.dimensions.width / result.dimensions.height).toFixed(3);
      console.log(`  ${colors.cyan}Dimensions:${colors.reset} ${result.dimensions.width}x${result.dimensions.height} (ratio: ${ratio})`);
    }
    
    console.log('');
    console.log(`${colors.bright}📦 Output Files:${colors.reset}`);
    
    // Main output file
    if (result.convertedAsset) {
      const outputFile = path.basename(result.convertedAsset);
      
      // Check if the file actually exists (might be fallback PNG)
      let actualPath = result.convertedAsset;
      if (!fs.existsSync(actualPath)) {
        // Check for fallback PNG
        const fallbackPath = actualPath.replace('.mp4', '_fallback.png').replace('.webm', '_fallback.png').replace('.gif', '_fallback.png');
        if (fs.existsSync(fallbackPath)) {
          actualPath = fallbackPath;
          console.log(`  ${colors.yellow}⚠${colors.reset} Video creation failed - using fallback PNG`);
        }
      }
      
      if (fs.existsSync(actualPath)) {
        const fileSize = fs.statSync(actualPath).size;
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        const displayFile = path.basename(actualPath);
        console.log(`  ${colors.green}✓${colors.reset} ${displayFile} (${fileSizeMB} MB)`);
        console.log(`    ${colors.blue}→${colors.reset} ${actualPath}`);
      } else {
        console.log(`  ${colors.red}✗${colors.reset} ${outputFile} (file not created)`);
      }
    }
    
    // Bundled HTML (if exists)
    if (result.bundledHtml) {
      const bundledFile = path.basename(result.bundledHtml);
      const fileSize = fs.statSync(result.bundledHtml).size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);
      console.log(`  ${colors.green}✓${colors.reset} ${bundledFile} (${fileSizeKB} KB)`);
      console.log(`    ${colors.blue}→${colors.reset} ${result.bundledHtml}`);
    }
    
    // Thumbnail (if exists)
    if (result.thumbnail) {
      const thumbFile = path.basename(result.thumbnail);
      const fileSize = fs.statSync(result.thumbnail).size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);
      console.log(`  ${colors.green}✓${colors.reset} ${thumbFile} (${fileSizeKB} KB)`);
      console.log(`    ${colors.blue}→${colors.reset} ${result.thumbnail}`);
    }
    
    console.log('');
    
    // Summary based on content type
    if (result.isDirectImage) {
      log('📸', 'Single image ZIP - Direct copy (no conversion)', colors.green);
    } else if (result.hasAnimations) {
      log('🎬', 'Animated HTML - Converted to MP4 video', colors.green);
    } else {
      log('🖼️', 'Static HTML - Converted to PNG', colors.green);
    }
    
    console.log('');
    log('🎉', 'All done!', colors.bright);
    
  } catch (error) {
    console.log('');
    log('❌', `Fatal error: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
${colors.bright}📦 ZIP to Video/Image Test Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node test-zip-to-output.cjs <path-to-zip-file>

${colors.cyan}Examples:${colors.reset}
  node test-zip-to-output.cjs ./Zip-Dateien/banner-animated.zip
  node test-zip-to-output.cjs ./Zip-Dateien/static-banner.zip
  node test-zip-to-output.cjs ./Zip-Dateien/single-image.zip

${colors.cyan}Output:${colors.reset}
  All processed files will be saved to: ${colors.green}server/output/${colors.reset}

${colors.cyan}Results:${colors.reset}
  • ${colors.yellow}Single image ZIP${colors.reset} → Direct copy (JPG/PNG/GIF)
  • ${colors.yellow}Static HTML ZIP${colors.reset} → PNG image
  • ${colors.yellow}Animated HTML ZIP${colors.reset} → MP4 video

${colors.cyan}Note:${colors.reset}
  No thumbnails or placeholders - only the final converted asset.
    `);
    process.exit(0);
  }
  
  const zipPath = path.resolve(args[0]);
  testZipProcessing(zipPath).catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { testZipProcessing };

