#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const HtmlConverter = require('./test-html-conversion.cjs');

/**
 * HTML File Handler
 * Handles HTML file processing for asset uploads
 */
class HtmlHandler {
  constructor() {
    this.browser = null;
  }

  /**
   * Process HTML file: convert to image/video (no thumbnail needed)
   */
  async processHtmlFile(htmlPath, outputDir = './temp') {
    try {
      console.log(`📄 Processing HTML file: ${htmlPath}`);
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Convert HTML to video/image
      console.log('🎬 Converting HTML to video/image...');
      const converter = new HtmlConverter();
      await converter.init();
      
      const conversionResult = await converter.convertHtmlFile(htmlPath, outputDir);
      await converter.cleanup();
      
      if (!conversionResult.success) {
        throw new Error(`Conversion failed: ${conversionResult.error}`);
      }
      
      console.log(`✅ Conversion result: ${conversionResult.outputPath}`);
      
      // No thumbnail needed - video will be used directly for screenshots
      const result = {
        success: true,
        convertedAsset: conversionResult.outputPath,
        thumbnail: null, // No thumbnail - video captures live frames
        hasAnimations: conversionResult.hasAnimations,
        assetType: conversionResult.hasAnimations ? 'video' : 'image'
      };
      
      // Output result for server parsing
      console.log('RESULT:' + JSON.stringify(result));
      
      return result;
      
    } catch (error) {
      console.error('❌ HTML processing failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node html-handler.js <html-file> [output-directory]');
    console.log('Example: node html-handler.js test.html ./output');
    process.exit(1);
  }

  const htmlPath = args[0];
  const outputDir = args[1] || './html-output';

  async function main() {
    const handler = new HtmlHandler();
    
    try {
      const result = await handler.processHtmlFile(htmlPath, outputDir);
      
      if (result.success) {
        console.log('\n🎉 HTML processing completed successfully!');
        console.log(`🎬 Converted Asset: ${result.convertedAsset}`);
        console.log(`🖼️ Thumbnail: ${result.thumbnail}`);
        console.log(`🎭 Has Animations: ${result.hasAnimations}`);
        console.log(`📊 Asset Type: ${result.assetType}`);
      } else {
        console.error('❌ HTML processing failed:', result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    }
  }

  main();
}

module.exports = HtmlHandler;
