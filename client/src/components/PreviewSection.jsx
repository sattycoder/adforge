import React, { useState, useEffect, useRef } from 'react';
import { Download, Eye, Check } from 'lucide-react';
import DeviceFrame from './DeviceFrame';
import AdOverlay from './AdOverlay';
import PlacedCreative from './PlacedCreative';
import SplitButton from './SplitButton';

const PreviewSection = ({
  screenshot,
  selectedDevice,
  detectedAds,
  imageSize,
  placements,
  handleOverlayClick,
  handleFileDrop,
  handleFullPageDownload,
  handleViewportDownload,
  handleDeviceScreenshot,
  onImageLoad,
  screenshotRef,
  onThumbnail,
  isScreenshotMode = false,
  isLoading = false,
  webpageUrl = '',
  header = null // { headerUrl, headerHeight, headerWidth }
}) => {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0); // 0, 1, or 2
  const [stickyHeaderEnabled, setStickyHeaderEnabled] = useState(false);
  const stepFlagsRef = useRef({ step1Complete: false, step2Complete: false, step3Complete: false });
  // Store original full-page screenshot dimensions for consistent ad positioning
  const originalImageSizeRef = useRef({ width: 0, height: 0 });
  // Track previous screenshot URL to detect URL changes
  const previousScreenshotRef = useRef(null);

  // CRITICAL: Reset all refs and state when screenshot URL changes (new URL loaded)
  useEffect(() => {
    if (screenshot !== previousScreenshotRef.current) {
      // New screenshot URL detected - this is a new page load
      const isNewUrl = previousScreenshotRef.current !== null; // Not the initial mount
      
      if (isNewUrl) {
        console.log(`[PreviewSection] 🔄 New screenshot URL detected - resetting state for fresh start`);
        console.log(`[PreviewSection] Previous: ${previousScreenshotRef.current?.substring(0, 50)}...`);
        console.log(`[PreviewSection] New: ${screenshot?.substring(0, 50)}...`);
        
        // Reset all refs and state for fresh start
        originalImageSizeRef.current = { width: 0, height: 0 };
        stepFlagsRef.current = { step1Complete: false, step2Complete: false, step3Complete: false };
        setStickyHeaderEnabled(false);
        setProgress(0);
        setCurrentStep(0);
      }
      
      // Update previous screenshot ref
      previousScreenshotRef.current = screenshot;
    }
  }, [screenshot]);

  // Store original full-page screenshot dimensions when imageSize is first set
  useEffect(() => {
    if (imageSize.width > 0 && imageSize.height > 0) {
      console.log(`[PreviewSection] imageSize changed:`, imageSize);
      console.log(`[PreviewSection] Current originalImageSizeRef:`, originalImageSizeRef.current);
      
      // Only update if we don't have original dimensions yet, or if dimensions are larger (full page vs cropped)
      if (!originalImageSizeRef.current.width || !originalImageSizeRef.current.height || 
          imageSize.height > originalImageSizeRef.current.height) {
        console.log(`[PreviewSection] Updating originalImageSizeRef from ${JSON.stringify(originalImageSizeRef.current)} to ${JSON.stringify(imageSize)}`);
        originalImageSizeRef.current = { ...imageSize };
      } else {
        console.log(`[PreviewSection] Keeping originalImageSizeRef (${JSON.stringify(originalImageSizeRef.current)}) - new size is smaller or same`);
      }
    }
  }, [imageSize]);
  
  // Check if image is already loaded when screenshot changes (cached scenario)
  useEffect(() => {
    if (screenshot && screenshotRef.current) {
      // Use a small delay to ensure the img element has the new src
      const checkImage = setTimeout(() => {
        if (screenshotRef.current) {
          const img = screenshotRef.current;
          if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
            console.log(`[PreviewSection] Image already loaded (cached):`, {
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              src: img.src.substring(0, 50) + '...'
            });
            // Trigger onImageLoad manually if image is already loaded
            const event = { target: img };
            onImageLoad?.(event);
          } else {
            console.log(`[PreviewSection] Image not yet loaded, waiting for onLoad event`);
          }
        }
      }, 100); // Small delay to ensure src is set
      
      return () => clearTimeout(checkImage);
    }
  }, [screenshot, onImageLoad]); // Include onImageLoad in dependencies

  useEffect(() => {
    if (!isLoading) {
      setProgress(0);
      setCurrentStep(0);
      stepFlagsRef.current = { step1Complete: false, step2Complete: false, step3Complete: false };
      // Reset sticky header toggle when loading completes (new page loaded)
      if (!screenshot) {
        setStickyHeaderEnabled(false);
        // CRITICAL: Reset originalImageSizeRef when screenshot is cleared (fresh load)
        originalImageSizeRef.current = { width: 0, height: 0 };
        console.log(`[PreviewSection] 🔄 Reset originalImageSizeRef (screenshot cleared, fresh load)`);
      }
      return;
    }

    // Reset progress when loading starts
    setProgress(0);
    setCurrentStep(0);
    stepFlagsRef.current = { step1Complete: false, step2Complete: false, step3Complete: false };
    
    // State machine: only move forward, never backward
    const updateStepFromFlags = (flags) => {
      const newFlags = {
        step1Complete: flags.step1Complete || stepFlagsRef.current.step1Complete,
        step2Complete: flags.step2Complete || stepFlagsRef.current.step2Complete,
        step3Complete: flags.step3Complete || stepFlagsRef.current.step3Complete
      };
      
      stepFlagsRef.current = newFlags;
      
      // Update step based on flags (only move forward - state machine)
      // Step 1 complete → move to Step 2 (currentStep = 1)
      // Step 2 complete → move to Step 3 (currentStep = 2)
      // Step 3 complete → stay at Step 3 (currentStep = 2)
      setCurrentStep(prevStep => {
        if (newFlags.step3Complete) return 2; // Step 3 active/completed
        if (newFlags.step2Complete) return 2; // Step 2 completed → move to Step 3
        if (newFlags.step1Complete) return 1; // Step 1 completed → move to Step 2
        // Never go backward - only forward progression
        return prevStep;
      });
    };
    
    // Listen for step updates from backend
    const handleStepUpdate = (event) => {
      const { step1Complete, step2Complete, step3Complete } = event.detail;
      if (step1Complete !== undefined || step2Complete !== undefined || step3Complete !== undefined) {
        updateStepFromFlags({ step1Complete, step2Complete, step3Complete });
      }
    };
    
    window.addEventListener('jobStepUpdate', handleStepUpdate);
    
    // Time-based fallback for progress bar animation
    const totalDuration = 80000; // 80 seconds total
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min((elapsed / totalDuration) * 100, 100);
      setProgress(currentProgress);
      
      // Use flag-based step determination if flags are set (prevents jitter)
      // Otherwise use time-based estimation for smooth visual feedback
      const flags = stepFlagsRef.current;
      if (flags.step3Complete) {
        // Step 3 completed → stay on Step 3
        setCurrentStep(2);
      } else if (flags.step2Complete) {
        // Step 2 completed → move to Step 3
        setCurrentStep(2);
      } else if (flags.step1Complete) {
        // Step 1 completed → move to Step 2
        setCurrentStep(1);
      } else {
        // Time-based fallback (only when no flags set yet)
        if (currentProgress < 30) {
          setCurrentStep(0); // Step 1: Page Setup & Initialization
        } else if (currentProgress < 70) {
          setCurrentStep(1); // Step 2: Content Loading & Stabilization
        } else {
          setCurrentStep(2); // Step 3: Ad Detection & Finalization
        }
      }
      
      if (currentProgress >= 100) {
        clearInterval(interval);
      }
    }, 100); // Update every 100ms for smooth animation

    return () => {
      clearInterval(interval);
      window.removeEventListener('jobStepUpdate', handleStepUpdate);
    };
  }, [isLoading]);

  return (
    <>
      <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
        <h2 className="text-lg font-brand text-gray-800">Screenshot Preview</h2>
        <div className="flex items-center gap-4">
          {header?.headerUrl && (
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-700">Sticky Header</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={stickyHeaderEnabled}
                  onChange={(e) => setStickyHeaderEnabled(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-11 h-7 rounded-full transition-colors duration-200 ${
                  stickyHeaderEnabled ? 'bg-blue-600' : 'bg-gray-300'
                }`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-200 ${
                    stickyHeaderEnabled ? 'translate-x-5 translate-y-1' : 'translate-x-1 translate-y-1'
                  }`}></div>
                </div>
              </div>
            </label>
          )}
          <SplitButton
            mainAction={handleDeviceScreenshot}
            mainLabel="Capture Frame"
            options={[
              {
                label: "Capture Fullpage",
                action: handleFullPageDownload
              },
              {
                label: "Capture Viewport", 
                action: handleViewportDownload
              }
            ]}
            disabled={!screenshot}
          />
        </div>
      </div>
      <div className="flex-1 p-4 overflow-hidden">
        {screenshot ? (
          <DeviceFrame device={selectedDevice}>
            <div 
              className="relative w-full" 
              style={{ 
                minHeight: '100%', 
                backgroundColor: 'transparent'
              }}
            >
              {/* Sticky Header - pinned at top of DeviceFrame viewport with accurate X1, X2 positioning */}
              {stickyHeaderEnabled && header && header.headerUrl && (
                <div 
                  className="sticky-header"
                  style={{
                    position: 'sticky',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 99999, // Highest z-index to overlay everything
                    width: '100%',
                    backgroundColor: 'white',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)', // More prominent shadow for separation
                    borderBottom: '0px solid #d1d5db', // Visual separator
                    marginBottom: 0, // No margin to keep it flush with content
                    willChange: 'transform', // Optimize for sticky positioning
                    display: 'flex',
                    justifyContent: 'flex-start', // Align header to left (X1 position)
                    alignItems: 'flex-start'
                  }}
                >
                  <img
                    src={header.headerUrl}
                    alt="Website Header"
                    style={{
                      display: 'block',
                      width: header.headerX !== undefined && header.headerX2 !== undefined
                        ? `${((header.headerX2 - header.headerX) / (selectedDevice === 'macbook-air' ? 1440 : 393)) * 100}%` // Calculate width percentage based on X1, X2 and device width
                        : 'auto', // Fallback to auto if X1/X2 not available
                      height: 'auto',
                      maxHeight: `${header.headerHeight || 200}px`,
                      objectFit: 'contain',
                      pointerEvents: 'none', // Allow clicks to pass through to content below if needed
                      marginLeft: header.headerX !== undefined
                        ? `${(header.headerX / (selectedDevice === 'macbook-air' ? 1440 : 393)) * 100}%` // Position at X1 percentage
                        : '0', // Fallback to 0 if X1 not available
                      left: header.headerX !== undefined
                        ? `${(header.headerX / (selectedDevice === 'macbook-air' ? 1440 : 393)) * 100}%` // Position at X1 percentage
                        : '0', // Fallback to 0 if X1 not available
                      marginRight: 'auto', // Push to left alignment
                      right: 'auto'
                    }}
                    onError={(e) => {
                      console.error('[PreviewSection] ❌ Failed to load header image:', header.headerUrl, e);
                    }}
                    onLoad={(e) => {
                      console.log('[PreviewSection] ✅ Header image loaded successfully', {
                        headerX: header.headerX,
                        headerX2: header.headerX2,
                        headerWidth: header.headerWidth,
                        device: selectedDevice
                      });
                    }}
                  />
                </div>
              )}
              
              {/* Static image preview - scrolls underneath sticky header */}
              {/* Use cropped screenshot when sticky header is enabled */}
              <img
                ref={screenshotRef}
                src={stickyHeaderEnabled && header?.croppedScreenshotUrl ? header.croppedScreenshotUrl : screenshot}
                alt="Webpage Screenshot"
                className="block w-full h-auto"
                onLoad={(e) => {
                  // Verify image actually loaded with valid dimensions
                  const img = e.target;
                  console.log(`[PreviewSection] Image onLoad fired:`, {
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    src: img.src,
                    isCropped: stickyHeaderEnabled && header?.croppedScreenshotUrl,
                    headerHeight: header?.headerHeight
                  });
                  
                  if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                    console.error('[PreviewSection] Image loaded with zero dimensions:', screenshot);
                  }
                  onImageLoad?.(e);
                }}
                onError={(e) => {
                  console.error('[PreviewSection] Failed to load screenshot image:', screenshot, e);
                  // Could set an error state here if needed
                }}
                style={{ display: 'block' }}
              />

              {/* Clickable ad slots - hidden during screenshot mode */}
              {!isScreenshotMode && imageSize.width > 0 && detectedAds.map((slot) => {
                // Use original full-page dimensions for positioning calculations
                // Adjust ad positions when sticky header is enabled: add header height to y-coordinate
                const baseImageSize = originalImageSizeRef.current.width > 0 
                  ? originalImageSizeRef.current 
                  : imageSize;
                
                // Debug logging for first ad slot
                if (slot.id === detectedAds[0]?.id) {
                  console.log(`[PreviewSection] Rendering ad overlay for slot:`, {
                    slotId: slot.id,
                    slotPosition: slot.position,
                    slotSize: slot.size,
                    imageSize,
                    originalImageSize: originalImageSizeRef.current,
                    baseImageSize,
                    stickyHeaderEnabled,
                    headerHeight: header?.headerHeight,
                    usingCropped: stickyHeaderEnabled && header?.croppedScreenshotUrl
                  });
                }
                
                const adjustedSlot = stickyHeaderEnabled && header?.headerHeight && header?.croppedScreenshotUrl
                  ? {
                      ...slot,
                      position: {
                        ...slot.position,
                        y: (slot.position?.y || 0)
                      }
                    }
                  : slot;
                
                return (
                  <AdOverlay
                    key={slot.id}
                    slot={adjustedSlot}
                    imageNaturalSize={baseImageSize}
                    onClick={() => handleOverlayClick(slot)}
                    onDrop={handleFileDrop}
                    disabled={typeof window !== 'undefined' && window.__admaker_overlays_disabled === true}
                  />
                );
              })}

              {/* Placed creatives (images) */}
              {imageSize.width > 0 && placements.map(p => {
                // Use original full-page dimensions for positioning calculations
                // Adjust placement positions when sticky header is enabled: add header height to y-coordinate
                const baseImageSize = originalImageSizeRef.current.width > 0 
                  ? originalImageSizeRef.current 
                  : imageSize;
                
                const adjustedPlacement = stickyHeaderEnabled && header?.headerHeight && header?.croppedScreenshotUrl
                  ? {
                      ...p,
                      rect: p.rect ? {
                        ...p.rect,
                        y: (p.rect.y || 0)
                      } : p.rect
                    }
                  : p;
                
                return (
                  <PlacedCreative
                    key={`placed-${p.id}`}
                    placement={adjustedPlacement}
                    imageNaturalSize={baseImageSize}
                    onThumbnail={onThumbnail}
                    isScreenshotMode={isScreenshotMode}
                  />
                );
              })}
            </div>
          </DeviceFrame>
        ) : (
          <div className="w-full h-full bg-gray-100 rounded-lg flex items-center justify-center">
            {isLoading ? (
              <div className="text-center w-full max-w-5xl px-8">
                <div className="text-2xl font-bold text-black mb-8 uppercase tracking-wide">
                  LOADING "{webpageUrl || 'URL'}" IN {selectedDevice === 'macbook-air' ? 'MACBOOK' : selectedDevice === 'iphone16' ? 'IPHONE' : selectedDevice?.toUpperCase() || 'DEVICE'} FOR INTERACTING.
                </div>
                
                {/* Three-step progress indicator */}
                <div className="flex items-start justify-center gap-6 mb-8">
                  {/* Step 1: Page Setup & Initialization */}
                  <div className={`relative flex-1 min-w-[280px] min-h-[230px] ${currentStep > 0 ? 'bg-blue-800' : currentStep === 0 ? 'bg-gray-400' : 'bg-gray-300'} rounded-lg p-8 transition-all duration-300`}>
                    <div className={`text-4xl font-bold mb-3 ${currentStep > 0 ? 'text-white' : 'text-black'}`}>
                      STEP 1
                    </div>
                    <div className={`text-base mb-8 ${currentStep > 0 ? 'text-white' : 'text-black'} leading-tight`}>
                      PAGE SETUP & INITIALIZATION
                    </div>
                    <div className="flex justify-center">
                      {currentStep > 0 ? (
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                          <Check className="w-6 h-6 text-blue-800" strokeWidth={3} />
                        </div>
                      ) : currentStep === 0 ? (
                        <div className="w-10 h-10 rounded-full border-2 border-black border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
                      )}
                    </div>
                  </div>

                  {/* Step 2: Content Loading & Stabilization */}
                  <div className={`relative flex-1 min-w-[280px] min-h-[230px] ${currentStep > 1 ? 'bg-blue-800' : currentStep === 1 ? 'bg-gray-400' : 'bg-gray-300'} rounded-lg p-8 transition-all duration-300`}>
                    <div className={`text-4xl font-bold mb-3 ${currentStep > 1 ? 'text-white' : 'text-black'}`}>
                      STEP 2
                    </div>
                    <div className={`text-base mb-8 ${currentStep > 1 ? 'text-white' : 'text-black'} leading-tight`}>
                      CONTENT LOADING & STABILIZATION
                    </div>
                    <div className="flex justify-center">
                      {currentStep > 1 ? (
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                          <Check className="w-6 h-6 text-blue-800" strokeWidth={3} />
                        </div>
                      ) : currentStep === 1 ? (
                        <div className="w-10 h-10 rounded-full border-2 border-black border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
                      )}
                    </div>
                  </div>

                  {/* Step 3: Ad Detection & Finalization */}
                  <div className={`relative flex-1 min-w-[280px] min-h-[230px] ${currentStep >= 2 ? 'bg-gray-400' : 'bg-gray-300'} rounded-lg p-8 transition-all duration-300`}>
                  <div className={`text-4xl font-bold mb-3 ${currentStep > 2 ? 'text-white' : 'text-black'}`}>
                      STEP 3
                    </div>
                    <div className={`text-base mb-8 ${currentStep > 2 ? 'text-white' : 'text-black'} leading-tight`}>
                      AD DETECTION & FINALIZATION
                    </div>
                    <div className="flex justify-center">
                      {currentStep >= 2 ? (
                        <div className="w-10 h-10 rounded-full border-2 border-black border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-10 h-10 rounded-full border-2 border-gray-500 border-t-transparent animate-spin" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Warning message - dynamic based on step */}
                <div className="text-blue-800 font-bold text-3xl uppercase tracking-wide">
                  {currentStep === 0 && "PLEASE STAND BY, DO NOT REFRESH THE PAGE"}
                  {currentStep === 1 && "PLEASE STAY WITH US, FINISHING UP"}
                  {currentStep === 2 && "HOLD TIGHT, ALMOST THERE"}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <Eye className="w-16 h-16 mx-auto mb-4" />
                <div className="text-lg">No screenshot captured</div>
                <div className="text-sm">Enter a URL and click "Preview URL"</div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default PreviewSection;
