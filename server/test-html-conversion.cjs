#!/usr/bin/env node

/**
 * Standalone HTML to Image/Video Conversion Tester
 * 
 * This script analyzes HTML files for animations and transitions,
 * then converts them to either PNG (static) or MP4 video (animated) accordingly.
 * 
 * Usage:
 *   node test-html-conversion.js <input-html-file> [output-dir]
 * 
 * Example:
 *   node test-html-conversion.js ./test.html ./output
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

class HtmlConverter {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.hypeMode = false; // Flag to enable HYPE-specific detection
  }
  
  /**
   * Set whether to use HYPE-specific detection and wait times
   */
  setHypeMode(enabled) {
    this.hypeMode = enabled;
    if (enabled) {
      console.log('   ℹ️  HYPE mode enabled - using framework detection');
    } else {
      console.log('   ℹ️  HYPE mode disabled - using fast wait times');
    }
  }

  async init() {
    console.log('🚀 Creating browser instance for conversion...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    this.page = await this.context.newPage();
    
    // Log console messages for debugging
    this.page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`   [BROWSER ${type.toUpperCase()}]:`, msg.text());
      }
    });
    
    // Log page errors
    this.page.on('pageerror', error => {
      console.log(`   [PAGE ERROR]:`, error.message);
    });
  }

  async cleanup() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Analyze HTML from file URL for animations (with proper base URL for resources)
   */
  async analyzeAnimationsFromFile(fileUrl, width = 300, height = 250) {
    console.log('🔍 Analyzing HTML for animations and transitions...');
    
    // CRITICAL: Set viewport to actual ad dimensions BEFORE loading content
    // This ensures animation frameworks like Hype initialize with correct dimensions
    await this.page.setViewportSize({ width, height });
    
    // Use goto() instead of setContent() so relative paths work!
    await this.page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    console.log('   ⏱️  Waiting for animation frameworks to initialize...');
    
    if (this.hypeMode) {
      // HYPE mode: Use smart detection with longer waits
      try {
        await this.page.waitForFunction(() => {
          if (typeof window.HYPE !== 'undefined' || 
              typeof window.HYPE_778 !== 'undefined' ||
              typeof window.HYPE_778F !== 'undefined' ||
              typeof window.HYPE_778T !== 'undefined') {
            return document.readyState === 'complete';
          }
          return false;
        }, { timeout: 10000 });
        
        console.log('   ✅ HYPE loaded, waiting for timeline initialization...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        console.log('   ⚠️  HYPE detection timeout, using fallback wait...');
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
    } else {
      // Fast mode: Wait for DOM + short delay for CSS animations
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      console.log('   ✅ Content loaded, analyzing animations...');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return await this._evaluateAnimations();
  }

  /**
   * Analyze HTML content for animations (legacy method for in-memory HTML)
   */
  async analyzeAnimations(htmlContent, width = 300, height = 250) {
    console.log('🔍 Analyzing HTML for animations and transitions...');
    
    // CRITICAL: Set viewport to actual ad dimensions BEFORE loading content
    // This ensures animation frameworks like Hype initialize with correct dimensions
    await this.page.setViewportSize({ width, height });
    
    await this.page.setContent(htmlContent, { waitUntil: 'networkidle' });
    
    // Wait for HYPE/Animate/GSAP to initialize (critical for bundled HTML)
    console.log('   ⏱️  Waiting for animation frameworks to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    return await this._evaluateAnimations();
  }

  /**
   * Common animation evaluation logic
   */
  async _evaluateAnimations() {
    
    const hasAnimations = await this.page.evaluate(() => {
      // Check for CSS animations
      const styleSheets = Array.from(document.styleSheets);
      let hasCSSAnimations = false;
      let keyframeCount = 0;
      
      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              hasCSSAnimations = true;
              keyframeCount++;
            }
            if (rule.type === CSSRule.STYLE_RULE) {
              const style = rule.style;
              if (style.animation && style.animation !== 'none') {
                hasCSSAnimations = true;
              }
              // Only count meaningful transitions (not browser defaults)
              const transition = style.transition;
              if (transition && 
                  transition !== 'none' && 
                  transition !== 'all 0s ease 0s' &&
                  transition !== 'all 0s ease-in-out 0s' &&
                  !transition.includes('hover') &&
                  transition.includes('s') && // Must have duration > 0
                  !transition.includes('0s')) {
                hasCSSAnimations = true;
              }
            }
          }
        } catch (e) {
          // Cross-origin stylesheets might throw errors
          console.warn('Could not access stylesheet:', e.message);
        }
      }

      // Check for JavaScript animations
      const animatedElements = document.querySelectorAll('*');
      let hasJSAnimations = false;
      let animatedElementCount = 0;
      
      for (const element of animatedElements) {
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.animation !== 'none') {
          hasJSAnimations = true;
          animatedElementCount++;
        }
        // Only count meaningful transitions (not browser defaults or inherited)
        const transition = computedStyle.transition;
        if (transition !== 'none' && 
            transition !== 'all 0s ease 0s' &&
            transition !== 'all 0s ease-in-out 0s' &&
            !transition.includes('hover') &&
            transition.includes('s') && // Must have duration > 0
            !transition.includes('0s')) {
          hasJSAnimations = true;
          animatedElementCount++;
        }
      }

      // Check for GSAP animations and other JS animation libraries
      const hasGSAP = typeof window.gsap !== 'undefined' || 
                      typeof window.TweenMax !== 'undefined' || 
                      typeof window.TimelineMax !== 'undefined';
      
      // Check for animation-related JavaScript code and frameworks
      const scripts = Array.from(document.scripts);
      let hasAnimationCode = false;
      
      // Check for Hype framework
      const hasHype = typeof window.HYPE !== 'undefined' || 
                      typeof window.HYPE_778 !== 'undefined' ||
                      typeof window.HYPE_778F !== 'undefined' ||
                      typeof window.HYPE_778T !== 'undefined';
      
      // Check for CreateJS/Adobe Animate
      const hasCreateJS = typeof window.createjs !== 'undefined' ||
                          typeof window.AdobeAn !== 'undefined';
      
      if (hasHype || hasCreateJS) {
        hasAnimationCode = true;
      } else {
        // Check script content and sources for animation code
        const allScriptContent = scripts.map(s => s.textContent || s.innerHTML).join('\n');
        const allScriptSrc = scripts.map(s => s.src).join('\n');
        
        // Check for animation libraries and patterns
        if (allScriptContent.includes('gsap') || 
            allScriptContent.includes('timeline') || 
            allScriptContent.includes('tween') ||
            allScriptContent.includes('setInterval') ||
            allScriptContent.includes('setTimeout') ||
            allScriptContent.includes('requestAnimationFrame') ||
            allScriptContent.includes('createjs.Ticker') ||
            allScriptContent.includes('AdobeAn.') ||
            allScriptContent.includes('animate') ||
            allScriptSrc.includes('createjs') ||
            allScriptSrc.includes('gsap') ||
            allScriptSrc.includes('anime')) {
          hasAnimationCode = true;
        }
      }

      // Check for canvas animations
      const canvases = document.querySelectorAll('canvas');
      let hasCanvasAnimations = false;
      
      if (canvases.length > 0) {
        // Check for animation libraries and frameworks
        const scripts = Array.from(document.scripts);
        const allScriptContent = scripts.map(s => s.textContent).join('\n');
        const allScriptSrc = scripts.map(s => s.src).join('\n');
        
        // Check for various animation patterns
        const hasAnimationLoop = allScriptContent.includes('requestAnimationFrame') || 
                                 allScriptContent.includes('setInterval') ||
                                 allScriptContent.includes('setTimeout');
        
        // Check for CreateJS/Adobe Animate
        const hasCreateJS = allScriptContent.includes('createjs.Ticker') ||
                           allScriptContent.includes('createjs.') ||
                           allScriptSrc.includes('createjs') ||
                           allScriptContent.includes('AdobeAn.') ||
                           typeof window.createjs !== 'undefined';
        
        // Check for other canvas animation libraries
        const hasOtherLibs = allScriptContent.includes('PIXI.') ||
                            allScriptContent.includes('Three.') ||
                            allScriptContent.includes('Phaser.') ||
                            typeof window.PIXI !== 'undefined' ||
                            typeof window.THREE !== 'undefined';
        
        hasCanvasAnimations = hasAnimationLoop || hasCreateJS || hasOtherLibs;
      }

      // Check for SVG animations
      const svgAnimations = document.querySelectorAll('animate, animateTransform, animateMotion');
      const hasSVGAnimations = svgAnimations.length > 0;

      // Check for video elements
      const videos = document.querySelectorAll('video');
      const hasVideos = videos.length > 0;

      return {
        hasCSSAnimations,
        hasJSAnimations: hasJSAnimations || hasGSAP || hasAnimationCode,
        hasCanvasAnimations,
        hasSVGAnimations,
        hasVideos,
        hasGSAP,
        hasAnimationCode,
        totalAnimatedElements: animatedElementCount,
        keyframeRules: keyframeCount
      };
    });

    console.log('📊 Animation Analysis Results:');
    console.log(`  - CSS Animations: ${hasAnimations.hasCSSAnimations}`);
    console.log(`  - JS Animations: ${hasAnimations.hasJSAnimations}`);
    console.log(`  - GSAP Library: ${hasAnimations.hasGSAP}`);
    console.log(`  - Animation Code: ${hasAnimations.hasAnimationCode}`);
    console.log(`  - Canvas Animations: ${hasAnimations.hasCanvasAnimations}`);
    console.log(`  - SVG Animations: ${hasAnimations.hasSVGAnimations}`);
    console.log(`  - Videos: ${hasAnimations.hasVideos}`);
    console.log(`  - Animated Elements: ${hasAnimations.totalAnimatedElements}`);
    console.log(`  - Keyframe Rules: ${hasAnimations.keyframeRules}`);

    // Consider it animated if there are meaningful animations
    const hasAnyAnimations = hasAnimations.hasCSSAnimations || 
                             hasAnimations.hasCanvasAnimations || 
                             hasAnimations.hasSVGAnimations || 
                             hasAnimations.hasVideos ||
                             hasAnimations.hasGSAP ||
                             hasAnimations.hasAnimationCode ||
                             // JS animations with CSS keyframes (DOM-based)
                             (hasAnimations.hasJSAnimations && hasAnimations.totalAnimatedElements > 0 && hasAnimations.keyframeRules > 0) ||
                             // JS animations with many elements but no keyframes (Canvas/library-based)
                             (hasAnimations.hasJSAnimations && hasAnimations.totalAnimatedElements >= 10);

    return {
      hasAnimations: hasAnyAnimations,
      details: hasAnimations
    };
  }

  /**
   * Capture a static screenshot (PNG) - page must already be loaded
   */
  async captureStaticScreenshot(outputPath, width = 300, height = 250) {
    console.log(`📸 Capturing static screenshot (${width}x${height})...`);
    
    // Viewport should already be set, but ensure it matches
    await this.page.setViewportSize({ width, height });
    
    const screenshot = await this.page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false
    });
    
    console.log(`✅ Static screenshot saved: ${outputPath}`);
    return outputPath;
  }

  /**
   * Capture animated frames and create MP4 video
   */
  async captureAnimatedVideo(outputPath, width = 300, height = 250, duration = 15000) {
    // Adjust duration based on dimensions - Hype animations often loop at 6-15 seconds
    let adjustedDuration = duration;
    if (width > 500 || height > 500) {
      adjustedDuration = 18000; // 18 seconds for larger formats
      console.log(`📐 Large dimension detected (${width}x${height}), using ${adjustedDuration}ms duration`);
    } else {
      console.log(`🎬 Capturing ${adjustedDuration}ms of animation`);
    }
    
    console.log(`🎬 Capturing animated video (${width}x${height}, ${adjustedDuration}ms)...`);
    
    // Check if viewport resize is needed to avoid unnecessary re-renders
    const currentViewport = this.page.viewportSize();
    if (!currentViewport || currentViewport.width !== width || currentViewport.height !== height) {
      await this.page.setViewportSize({ width, height });
      
      // CRITICAL: Wait for images to reload after viewport change
      console.log('   ⏱️  Viewport changed, waiting for images to reload...');
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        console.log('   ⚠️  Network idle timeout, continuing anyway...');
      });
      
      // Extra wait for HYPE to re-initialize after viewport change
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Ensure all images are loaded before starting capture
    const imagesLoaded = await this.page.evaluate(() => {
      const images = Array.from(document.getElementsByTagName('img'));
      return images.every(img => img.complete && img.naturalHeight !== 0);
    });
    
    if (!imagesLoaded) {
      console.log('   ⚠️  Some images not loaded, waiting...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('   ✅ All images loaded, starting capture immediately');
    }
    
    // Use FFmpeg to create video from screenshots
    const { execSync } = require('child_process');
    const framesDir = outputPath.replace('.mp4', '_frames').replace('.webm', '_frames');
    
    // Create frames directory
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }
    
    // Capture frames at 30fps for smooth video with smart duration detection
    const fps = 30;
    const frameDelay = 1000 / fps;
    const minDuration = 3000; // Minimum 3 seconds to capture at least one loop
    const maxDuration = adjustedDuration; // Maximum duration as safety net
    const minFrames = Math.ceil((minDuration / 1000) * fps);
    const maxFrames = Math.ceil((maxDuration / 1000) * fps);
    
    console.log(`📹 Capturing frames with smart duration detection (${minDuration / 1000}s - ${maxDuration / 1000}s)...`);
    
    let previousFrame = null;
    let stableFrameCount = 0;
    const stableThreshold = 90; // Consider stable after 90 identical frames (3 seconds at 30fps)
    let frameIndex = 0;
    let capturedFrames = 0;
    
    while (frameIndex < maxFrames) {
      const screenshot = await this.page.screenshot({
        type: 'png',
        fullPage: false
      });
      
      const framePath = path.join(framesDir, `frame_${frameIndex.toString().padStart(4, '0')}.png`);
      fs.writeFileSync(framePath, screenshot);
      capturedFrames++;
      
      // Compare with previous frame to detect when animation stops
      if (frameIndex >= minFrames && previousFrame) {
        // Simple buffer comparison - frames are identical if buffers match
        const framesIdentical = Buffer.compare(screenshot, previousFrame) === 0;
        
        if (framesIdentical) {
          stableFrameCount++;
          if (stableFrameCount >= stableThreshold) {
            console.log(`   ✅ Animation stabilized after ${((frameIndex + 1 - stableThreshold) / fps).toFixed(2)}s (stopped at frame ${frameIndex + 1}, stable for ${stableThreshold / fps}s)`);
            break;
          }
        } else {
          stableFrameCount = 0; // Reset counter if frames differ
        }
      }
      
      previousFrame = screenshot;
      frameIndex++;
      
      // Progress indicator
      if ((frameIndex) % 90 === 0) {
        console.log(`   📊 Captured ${frameIndex} frames (${(frameIndex / fps).toFixed(1)}s)...`);
      }
      
      if (frameIndex < maxFrames) {
        await new Promise(resolve => setTimeout(resolve, frameDelay));
      }
    }
    
    if (frameIndex >= maxFrames) {
      console.log(`   ⏱️  Reached maximum duration ${maxDuration / 1000}s (${capturedFrames} frames)`);
    }
    
    console.log(`✅ Frames captured (${capturedFrames} frames, ${(capturedFrames / fps).toFixed(2)}s)`);
    console.log(`🎬 Creating MP4 video with FFmpeg...`);
    
    try {
      // Create MP4 video with FFmpeg (H.264 codec, web-optimized)
      const outputPathAbs = path.resolve(outputPath);
      const videoCommand = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -movflags +faststart "${outputPathAbs}"`;
      
      console.log(`📝 Command: ffmpeg -framerate ${fps} -i frames -c:v libx264...`);
      
      execSync(videoCommand, { 
        stdio: 'pipe',
        shell: '/bin/bash'
      });
      
      // Verify output file was created
      if (!fs.existsSync(outputPathAbs)) {
        throw new Error('Video file was not created');
      }
      
      const stats = fs.statSync(outputPathAbs);
      if (stats.size === 0) {
        throw new Error('Video file is empty');
      }
      
      console.log(`✅ Video created successfully: ${outputPathAbs}`);
      console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
      
      // Clean up frames directory
      fs.rmSync(framesDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up frames directory`);
      
    } catch (error) {
      console.error(`❌ FFmpeg conversion failed: ${error.message}`);
      console.log(`💡 Frames saved at: ${framesDir}`);
      console.log(`💡 To create video manually, run:`);
      console.log(`   ffmpeg -framerate ${fps} -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p "${path.resolve(outputPath)}"`);
      
      // Fallback: Use first frame as a static PNG
      const firstFramePath = path.join(framesDir, 'frame_0000.png');
      if (fs.existsSync(firstFramePath)) {
        const fallbackPath = outputPath.replace('.mp4', '_fallback.png').replace('.webm', '_fallback.png');
        fs.copyFileSync(firstFramePath, fallbackPath);
        console.log(`📸 Fallback: Using first frame as static PNG: ${fallbackPath}`);
        return fallbackPath;
      }
      
      throw new Error(`FFmpeg video creation failed and no frames available: ${error.message}`);
    }
    
    return outputPath;
  }

  /**
   * Extract dimensions from HTML content
   */
  extractDimensions(htmlContent) {
    // Look for meta tags with ad.size
    const adSizeMatch = htmlContent.match(/<meta[^>]*name="ad\.size"[^>]*content="width=(\d+),height=(\d+)"[^>]*>/i);
    if (adSizeMatch) {
      return { width: parseInt(adSizeMatch[1]), height: parseInt(adSizeMatch[2]) };
    }
    
    // Look for Hype/Tumult container dimensions in inline style
    const hypeContainerMatch = htmlContent.match(/class="HYPE_document"[^>]*style="[^"]*width:\s*(\d+)px[^"]*height:\s*(\d+)px/i);
    if (hypeContainerMatch) {
      return { width: parseInt(hypeContainerMatch[1]), height: parseInt(hypeContainerMatch[2]) };
    }
    
    // Look for any div with explicit width/height in style attribute
    const divStyleMatch = htmlContent.match(/<div[^>]*style="[^"]*width:\s*(\d+)px[^"]*height:\s*(\d+)px/i);
    if (divStyleMatch) {
      return { width: parseInt(divStyleMatch[1]), height: parseInt(divStyleMatch[2]) };
    }
    
    // Look for CSS dimensions in #banner
    const bannerMatch = htmlContent.match(/#banner[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/);
    if (bannerMatch) {
      return { width: parseInt(bannerMatch[1]), height: parseInt(bannerMatch[2]) };
    }
    
    // Look for JavaScript variables
    const widthMatch = htmlContent.match(/var\s+adWidth\s*=\s*(\d+)/);
    const heightMatch = htmlContent.match(/var\s+adHeight\s*=\s*(\d+)/);
    if (widthMatch && heightMatch) {
      return { width: parseInt(widthMatch[1]), height: parseInt(heightMatch[1]) };
    }
    
    // Default dimensions
    return { width: 300, height: 250 };
  }

  /**
   * Convert HTML file to image
   */
  async convertHtmlFile(inputPath, outputDir = './output') {
    try {
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Read HTML file to extract dimensions
      const htmlContent = fs.readFileSync(inputPath, 'utf8');
      console.log(`📄 Loaded HTML file: ${inputPath}`);

      // Extract dimensions from HTML
      const dimensions = this.extractDimensions(htmlContent);
      console.log(`📐 Detected dimensions: ${dimensions.width}x${dimensions.height}`);

      // CRITICAL FIX: Use file:// URL instead of setContent() so relative paths work
      const fileUrl = 'file://' + path.resolve(inputPath);
      
      // Analyze for animations (pass dimensions and use file URL)
      const analysis = await this.analyzeAnimationsFromFile(fileUrl, dimensions.width, dimensions.height);
      
      const baseName = path.basename(inputPath, '.html');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      let outputPath;
      
      if (analysis.hasAnimations) {
        console.log('🎭 Animations detected - creating video (MP4)...');
        outputPath = path.join(outputDir, `${baseName}_animated_${timestamp}.mp4`);
        
        // CRITICAL: Reload page to reset animation to frame 0
        console.log('🔄 Reloading page to reset animation to beginning...');
        await this.page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        if (this.hypeMode) {
          // HYPE mode: Wait for HYPE to initialize
          try {
            await this.page.waitForFunction(() => {
              if (typeof window.HYPE !== 'undefined' || 
                  typeof window.HYPE_778 !== 'undefined' ||
                  typeof window.HYPE_778F !== 'undefined' ||
                  typeof window.HYPE_778T !== 'undefined') {
                return document.readyState === 'complete';
              }
              return false;
            }, { timeout: 10000 });
            console.log('   ✅ HYPE reloaded, ready to capture');
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (e) {
            console.log('   ⚠️  HYPE detection timeout after reload');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          // Fast mode: Short wait for animations to reset
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          console.log('   ✅ Page reloaded, ready to capture');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        await this.captureAnimatedVideo(outputPath, dimensions.width, dimensions.height);
      } else {
        console.log('🖼️ No animations detected - creating static PNG...');
        outputPath = path.join(outputDir, `${baseName}_static_${timestamp}.png`);
        await this.captureStaticScreenshot(outputPath, dimensions.width, dimensions.height);
      }

      return {
        success: true,
        outputPath,
        hasAnimations: analysis.hasAnimations,
        analysis: analysis.details
      };

    } catch (error) {
      console.error('❌ Conversion failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
📋 HTML to Image/GIF Converter

Usage:
  node test-html-conversion.js <input-html-file> [output-dir]

Examples:
  node test-html-conversion.js ./test.html
  node test-html-conversion.js ./test.html ./output
  node test-html-conversion.js /path/to/file.html /path/to/output

Features:
  ✅ Analyzes HTML for animations and transitions
  ✅ Converts to PNG for static content
  ✅ Converts to GIF for animated content
  ✅ Detailed animation analysis report
    `);
    process.exit(1);
  }

  const inputPath = args[0];
  const outputDir = args[1] || './output';

  // Validate input file
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  if (!inputPath.endsWith('.html')) {
    console.error(`❌ Input file must be an HTML file: ${inputPath}`);
    process.exit(1);
  }

  console.log('🎯 HTML to Image/GIF Converter');
  console.log(`📁 Input: ${inputPath}`);
  console.log(`📁 Output: ${outputDir}`);
  console.log('');

  const converter = new HtmlConverter();
  
  try {
    await converter.init();
    const result = await converter.convertHtmlFile(inputPath, outputDir);
    
    if (result.success) {
      console.log('');
      console.log('🎉 Conversion completed successfully!');
      console.log(`📄 Output: ${result.outputPath}`);
      console.log(`🎭 Has Animations: ${result.hasAnimations}`);
      console.log(`📊 Type: ${result.hasAnimations ? 'Animated GIF' : 'Static PNG'}`);
    } else {
      console.error('❌ Conversion failed:', result.error);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await converter.cleanup();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = HtmlConverter;
