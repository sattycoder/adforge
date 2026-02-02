import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Download, Eye, Target, Image as ImageIcon } from 'lucide-react';
import DeviceFrame from '../components/DeviceFrame';
import AdOverlay from '../components/AdOverlay';
import UrlSection from '../components/UrlSection';
import PreviewSection from '../components/PreviewSection';
import { api } from '../services/api';
import { useStatus } from '../hooks/useStatus';

const MainInterface = () => {
  const { user, logout } = useAuth();
  const [webpageUrl, setWebpageUrl] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('macbook-air');
  const [screenshot, setScreenshot] = useState(null);
  const [detectedAds, setDetectedAds] = useState([]);
  const [selectedAd, setSelectedAd] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { status, setStatus, clearStatus } = useStatus();
  const [error, setError] = useState('');
  
  // Cleanup status timeout on unmount
  useEffect(() => {
    return () => {
      clearStatus();
    };
  }, [clearStatus]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [placements, setPlacements] = useState([]);
  const [detected, setDetected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buttonState, setButtonState] = useState('preview');
  const [profileOpen, setProfileOpen] = useState(false);
  
  // Device preloading state
  const [deviceScreenshots, setDeviceScreenshots] = useState({
    iphone16: null,
    'macbook-air': null
  });
  const [deviceAdSlots, setDeviceAdSlots] = useState({
    iphone16: [],
    'macbook-air': []
  });
  const [deviceHeaders, setDeviceHeaders] = useState({
    iphone16: null,
    'macbook-air': null
  });
  const [isPreloading, setIsPreloading] = useState(false);
  const [isScreenshotMode, setIsScreenshotMode] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]);
  
  const fileInputRef = useRef(null);
  const screenshotRef = useRef(null);
  const pendingSlotRef = useRef(null);
  const busyRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Disable overlays while busy or queue has items
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__admaker_overlays_disabled = busy || (uploadQueue.length > 0);
      console.log('Overlays disabled:', busy || (uploadQueue.length > 0), { busy, queueLength: uploadQueue.length });
    }
  }, [busy, uploadQueue]);

  const handlePreviewUrl = async () => {
    if (!webpageUrl) {
      setStatus('Please enter a webpage URL');
      return;
    }

    // Validate URL format
    try {
      new URL(webpageUrl);
    } catch {
      setStatus('❌ Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    // Prevent multiple simultaneous requests
    if (isLoading || isPreloading) {
      setStatus('⏳ Request already in progress, please wait...');
      return;
    }

    setIsLoading(true);
    setIsPreloading(true);
    setError('');
    
    // CRITICAL: Reset ALL state immediately to ensure fresh start for each URL
    // This prevents stale state from previous URL from affecting new load
    setPlacements([]);
    setScreenshot(null);
    setDetectedAds([]);
    setImageSize({ width: 0, height: 0 }); // Reset imageSize to force fresh initialization
    setDeviceScreenshots({ iphone16: null, 'macbook-air': null });
    setDeviceAdSlots({ iphone16: [], 'macbook-air': [] });
    setDeviceHeaders({ iphone16: null, 'macbook-air': null });
    
    console.log(`[MainInterface] 🔄 Fresh start for URL: ${webpageUrl} - All state reset`);

    try {
      // Load devices in parallel for faster processing
      const devices = ['iphone16', 'macbook-air'];
      
      console.log('🔄 Starting parallel device loading...');
      
      // Process all devices in parallel with individual error handling
      const devicePromises = devices.map(async (device) => {
        try {
          console.log(`🔄 Loading ${device} in parallel...`);
          
          // SOLUTION: Use polling to avoid 60s timeout, but handle cached responses directly
          // 1. Request job ID or cached data
          const startResponse = await api.renderPage({ url: webpageUrl, device, userEmail: user?.email });
          
          if (!startResponse.data?.success) {
            const errorMsg = startResponse.data?.message || `Failed to start job for ${device}`;
            console.error(`❌ [MainInterface.jsx] Failed to start job for ${device}:`, errorMsg);
            throw new Error(errorMsg);
          }
          
          const responseData = startResponse.data.data;
          
          // Check if this is a cached response (has cached flag or actual page data)
          if (responseData?.cached || (responseData?.screenshotUrl && !responseData?.jobId)) {
            // Cached response - use data directly, no polling needed
            console.log(`📦 [MainInterface.jsx] Serving cached data for ${device}`);
            console.log(`📦 [MainInterface.jsx] Cached data keys:`, Object.keys(responseData));
            console.log(`📦 [MainInterface.jsx] Cached data has header:`, !!responseData.header);
            if (responseData.header) {
              console.log(`📦 [MainInterface.jsx] Cached header:`, JSON.stringify(responseData.header, null, 2));
            }
            return { device, data: responseData, error: null };
          }
          
          // Not cached - check for jobId to start polling
          if (!responseData?.jobId) {
            const errorMsg = `Invalid response: missing jobId for ${device}`;
            console.error(`❌ [MainInterface.jsx] ${errorMsg}`);
            throw new Error(errorMsg);
          }
          
          const jobId = responseData.jobId;
          console.log(`📥 [MainInterface.jsx] Job ${jobId} started for ${device}, polling for status...`);
          
          // 2. Poll for job completion (short requests every 3 seconds)
          const pollInterval = 3000; // 3 seconds between polls
          const maxPolls = 100; // 100 polls = 5 minutes max
          const startTime = Date.now();
          const timeout = 300000; // 5 minutes total
          
          for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
            // Check timeout
            if (Date.now() - startTime > timeout) {
              throw new Error(`Timeout loading ${device} after 5 minutes`);
            }
            
            // Wait before polling (except first poll)
            if (pollCount > 0) {
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
            
            try {
              const statusResponse = await api.getJobStatus(jobId);
              const statusData = statusResponse.data;
              
              if (statusData?.success && statusData?.data) {
                const { status, result, error, step1Complete, step2Complete, step3Complete } = statusData.data;
                
                // Dispatch step update event for PreviewSection
                if (step1Complete || step2Complete || step3Complete) {
                  let step = 0;
                  if (step3Complete) step = 3;
                  else if (step2Complete) step = 2;
                  else if (step1Complete) step = 1;
                  
                  window.dispatchEvent(new CustomEvent('jobStepUpdate', {
                    detail: { jobId, step, step1Complete, step2Complete, step3Complete }
                  }));
                }
                
                if (status === 'completed' && result) {
                  console.log(`✅ [MainInterface.jsx] Job ${jobId} completed for ${device}`);
                  return { device, data: result, error: null };
                } else if (status === 'failed') {
                  throw new Error(error || `Job ${jobId} failed`);
                } else if (status === 'waiting' || status === 'active' || status === 'delayed') {
                  // Still processing, continue polling
                  continue;
                }
              }
            } catch (pollErr) {
              // If polling fails, check if it's a network error or job error
              if (pollErr?.response?.status === 404) {
                throw new Error(`Job ${jobId} not found`);
              }
              // For other errors, continue polling (might be temporary network issue)
              console.warn(`⚠️ [MainInterface.jsx] Poll error for ${device} (attempt ${pollCount + 1}):`, pollErr.message);
            }
          }
          
          // If we get here, max polls reached
          throw new Error(`Timeout loading ${device} - job ${jobId} did not complete in time`);
        } catch (err) {
          // Enhanced error logging with component/file identification
          const errorDetails = {
            component: 'MainInterface.handlePreviewUrl',
            file: 'MainInterface.jsx',
            device,
            url: webpageUrl,
            errorType: err?.response?.status ? `HTTP_${err.response.status}` : err?.name || 'UNKNOWN',
            errorMessage: err?.message || 'Unknown error',
            responseData: err?.response?.data,
            stack: err?.stack
          }
          
          console.error(`❌ [MainInterface.jsx] Error loading ${device}:`, errorDetails);
          
          // Handle 429 (request already in progress) with retry
          if (err?.response?.status === 429) {
            console.log(`⏳ [MainInterface.jsx] Request queued for ${device}, waiting and retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            
            try {
              const { data } = await api.renderPage({ url: webpageUrl, device, userEmail: user?.email });
              if (data?.success) {
                console.log(`✅ [MainInterface.jsx] Retry success for ${device}`);
                return { device, data: data.data, error: null };
              }
            } catch (retryErr) {
              const retryErrorDetails = {
                component: 'MainInterface.handlePreviewUrl (retry)',
                file: 'MainInterface.jsx',
                device,
                error: retryErr?.message,
                stack: retryErr?.stack
              }
              console.error(`❌ [MainInterface.jsx] Retry failed for ${device}:`, retryErrorDetails);
            }
          }
          
          // Return detailed error for user display
          const userErrorMessage = err?.response?.data?.message || err?.message || 'Failed to load webpage';
          return { device, data: null, error: `${userErrorMessage} [MainInterface.jsx:${device}]` };
        }
      });
      
      // Wait for all devices to complete (in parallel)
      const results = await Promise.all(devicePromises);
      
      // Store results for each device
      const newDeviceScreenshots = { ...deviceScreenshots };
      const newDeviceAdSlots = { ...deviceAdSlots };
      const newDeviceHeaders = { ...deviceHeaders };
      let successCount = 0;
      
      results.forEach(({ device, data, error }) => {
        if (data && !error) {
          console.log(`[MainInterface] Processing result for ${device}:`, {
            hasScreenshot: !!data.screenshotUrl,
            hasAdSlots: !!(data.adSlots && data.adSlots.length),
            hasHeader: !!data.header,
            dataKeys: Object.keys(data)
          });
          newDeviceScreenshots[device] = data.screenshotUrl;
          newDeviceAdSlots[device] = data.adSlots || [];
          newDeviceHeaders[device] = data.header || null; // Store header info
          successCount++;
          console.log(`✅ Successfully loaded ${device}:`, data.screenshotUrl);
          if (data.header) {
            console.log(`📋 Header data received for ${device}:`, JSON.stringify(data.header, null, 2));
            console.log(`📋 Header URL: ${data.header.headerUrl}`);
          } else {
            console.log(`⚠️ No header data for ${device} - data.header is:`, data.header);
            console.log(`⚠️ Full data object keys:`, Object.keys(data));
          }
        } else {
          console.error(`❌ Failed to load ${device}:`, error);
          setStatus(`⚠️ Failed to load ${device === 'iphone16' ? 'iPhone 16' : 'MacBook Air'}: ${error}`);
        }
      });

      setDeviceScreenshots(newDeviceScreenshots);
      setDeviceAdSlots(newDeviceAdSlots);
      setDeviceHeaders(newDeviceHeaders);
      
      // Set current device screenshot
      setScreenshot(newDeviceScreenshots[selectedDevice]);
      setDetectedAds(newDeviceAdSlots[selectedDevice]);
      
      if (successCount === 2) {
        setStatus(`✅ Webpage loaded successfully for both devices (parallel processing)! Detected ${newDeviceAdSlots[selectedDevice]?.length || 0} ad elements.`);
      } else if (successCount === 1) {
        const failedDevice = results.find(r => r.error)?.device;
        const deviceName = failedDevice === 'iphone16' ? 'iPhone 16' : 'MacBook Air';
        setStatus(`⚠️ Webpage loaded for ${successCount} device(s). ${deviceName} failed to load.`);
      } else {
        throw new Error('Failed to load webpage for any device');
      }
      
      setButtonState('preview');
      
    } catch (err) {
      // Enhanced error logging with full details
      const errorDetails = {
        component: 'MainInterface.handlePreviewUrl (catch)',
        file: 'MainInterface.jsx',
        url: webpageUrl,
        errorType: err?.name || 'UNKNOWN',
        errorMessage: err?.message || 'Unknown error',
        responseStatus: err?.response?.status,
        responseData: err?.response?.data,
        stack: err?.stack
      }
      console.error('❌ [MainInterface.jsx] Preview error (FULL DETAILS):', errorDetails);
      
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to load webpage';
      setError(errorMessage);
      
      // Provide specific error guidance with file identification
      if (errorMessage.includes('timeout')) {
        setStatus(`❌ [MainInterface.jsx] Request timed out after 5 minutes. The website may be slow or blocked. Try a different URL.`);
      } else if (errorMessage.includes('CORS') || errorMessage.includes('blocked')) {
        setStatus(`❌ [MainInterface.jsx] Website blocked by CORS policy. Try a different website.`);
      } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        setStatus(`❌ [MainInterface.jsx] Website not found. Please check the URL.`);
      } else {
        setStatus(`❌ [MainInterface.jsx] Error: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
      setIsPreloading(false);
    }
  };


  // Handle device switching with preloaded screenshots
  const handleDeviceChange = (newDevice) => {
    if (newDevice !== selectedDevice) {
      setSelectedDevice(newDevice);
      
      // Reset placed assets when device changes
      setPlacements([]);
      // Switch to preloaded screenshot if available
      if (deviceScreenshots[newDevice]) {
        // CRITICAL: Reset imageSize when switching devices to force fresh initialization
        // This ensures ad overlays are recalculated with correct dimensions for the new device
        setImageSize({ width: 0, height: 0 });
        setScreenshot(deviceScreenshots[newDevice]);
        setDetectedAds(deviceAdSlots[newDevice]);
        // Header is passed via prop automatically through deviceHeaders[selectedDevice]
        console.log(`[MainInterface] Device switched to ${newDevice}, reset imageSize for fresh load`);
        console.log(`[MainInterface] Device switched to ${newDevice}, header available:`, !!deviceHeaders[newDevice]);
        if (deviceHeaders[newDevice]) {
          console.log(`[MainInterface] Header for ${newDevice}:`, deviceHeaders[newDevice]);
        }
        // setStatus(`📱 Switched to ${newDevice === 'iphone16' ? 'iPhone 16' : 'MacBook Air'} view`);
    //   } else {
    //     setStatus('⚠️ No preloaded screenshot for this device. Click "Preview URL" to load.');
    }
    }
  };

  const handleOverlayClick = useCallback((slot) => {
    if (busy) return;
    pendingSlotRef.current = slot;
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }, [busy]);

  const handleFileDrop = useCallback(async (file, slot) => {
    // Check both state and ref to ensure we have current value
    if (busyRef.current || busy) {
      console.log('Upload blocked - busy state:', { busyRef: busyRef.current, busy });
      setStatus('⏳ Upload in progress. Added to queue...');
      setUploadQueue((prev) => [...prev, { file, slot }]);
      return;
    }
    
    // Validate file type (allow images, videos, HTML, and ZIP files)
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isHtml = file.type === 'text/html' || file.type === 'application/xhtml+xml';
    const isZip = file.type === 'application/zip' || file.name.endsWith('.zip');
    if (!isImage && !isVideo && !isHtml && !isZip) {
      setStatus('❌ Unsupported file. Use image, video, HTML, or ZIP file.');
      return;
    }
    
    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setStatus('❌ File size too large. Please select a file smaller than 50MB.');
      return;
    }
    
    busyRef.current = true;
    setBusy(true);
    setStatus('🔄 Uploading creative...');
    
    // Show loading state immediately for ZIP and HTML files
    if (isZip || isHtml) {
      const loadingPlacement = {
        id: slot.id,
        type: isZip ? 'zip' : 'html',
        isProcessing: true,
        processingMessage: isZip ? 'Loading ZIP...' : 'Loading HTML...',
        rect: { ...slot.position, width: slot.size?.width, height: slot.size?.height }
      };
      setPlacements(prev => [...prev.filter(p => p.id !== slot.id), loadingPlacement]);
    }
    
    // Set a timeout to reset busy state if something goes wrong
    // Use longer timeout for ZIP/HTML processing
    const timeoutDuration = (isZip || isHtml) ? 120000 : 30000; // 2 minutes for ZIP/HTML, 30 seconds for others
    const timeoutId = setTimeout(() => {
      console.log('Upload timeout - resetting busy state');
      setBusy(false);
      setStatus('❌ Upload timeout - please try again');
    }, timeoutDuration);
    
    try {
      console.log('Uploading file:', file.name, file.size, file.type);
      const form = new FormData();
      
      let uploadRes;
      let data;
      
      if (isZip) {
        // Process ZIP file with ad frame dimensions
        form.append('zip', file);
        // Add ad frame dimensions to the form data
        if (slot.size && slot.size.width && slot.size.height) {
          form.append('adFrameWidth', slot.size.width.toString());
          form.append('adFrameHeight', slot.size.height.toString());
          console.log(`Processing ZIP file with ad frame dimensions: ${slot.size.width}x${slot.size.height}px`);
        } else {
          console.log('Processing ZIP file (no frame dimensions available)');
        }
        uploadRes = await api.processZipAsset(form);
        data = uploadRes?.data?.data;
      } else if (isHtml) {
        // Process HTML file directly
        form.append('html', file);
        console.log('Processing HTML file...');
        uploadRes = await api.processHtmlAsset(form);
        data = uploadRes?.data?.data;
      } else {
        // Process regular assets (images, videos)
        form.append('asset', file);
        console.log('Processing regular asset...');
        uploadRes = await api.uploadAsset(form);
        data = uploadRes?.data?.data;
      }
      
      console.log('Upload response:', uploadRes);
      let url, mimeType;
      
      if (isZip || isHtml) {
        // For ZIP/HTML files, use the converted asset (GIF/PNG)
        url = data?.url; // The server returns 'url' for converted assets
        mimeType = data?.type === 'gif' ? 'image/gif' : 'image/png';
      } else {
        // For regular assets, use the standard URL
        url = data?.url || data?.imageUrl;
        mimeType = data?.mimeType || file.type;
      }
      
      if (!url) throw new Error('Upload failed - no url in response');
      
      let type = 'image';
      let htmlContent = null;
      // Only use thumbnailUrl for ZIPs/HTML, never for direct GIF uploads
      let thumbnailUrl = (isZip || isHtml) ? data?.thumbnailUrl : null;
      
      if (isZip) {
        // ZIP processing result
        type = data?.type || 'image';
        
        // Check if this is a direct image (single image ZIP)
        if (data?.isDirectImage) {
          console.log('Direct image from ZIP detected - treating as regular image');
          type = data?.type || 'image'; // 'image' or 'gif'
          // No HTML content, no bundled HTML, just use the image URL directly
        } else if (data?.bundledHtml) {
          // HTML-based ZIP with resources
          try {
            const response = await fetch(data.bundledHtml);
            htmlContent = await response.text();
          } catch (error) {
            console.warn('Could not read bundled HTML content:', error);
          }
        }
      } else if (isHtml) {
        // HTML processing result
        type = data?.type || 'image';
        if (data?.hasAnimations) {
          // For animated HTML, we might need to read the HTML content
          try {
            const response = await fetch(url);
            htmlContent = await response.text();
          } catch (error) {
            console.warn('Could not read HTML content:', error);
          }
        }
      } else {
        // Regular asset processing
        if (mimeType?.startsWith('video/')) type = 'video';
        else if (mimeType === 'image/gif') type = 'gif';
        else if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
          const isBundledHtml = file.name.includes('bundled') || file.name.includes('bundle');
          type = isBundledHtml ? 'bundled-html' : 'html';
        }
      }

      let newPlacement = {
        id: slot.id,
        type,
        url,
        htmlContent,
        imageUrl: isImage ? url : undefined,
        thumbnailUrl: thumbnailUrl,
        rect: { ...slot.position, width: slot.size?.width, height: slot.size?.height },
        assetDimensions: data?.dimensions,
        adFrameDimensions: data?.adFrameDimensions
      };
      
      // Log aspect ratio information
      if (data?.dimensions && slot.size) {
        const assetRatio = (data.dimensions.width / data.dimensions.height).toFixed(3);
        const frameRatio = (slot.size.width / slot.size.height).toFixed(3);
        console.log(`Aspect ratios - Asset: ${assetRatio}, Frame: ${frameRatio}`);
      }

      // For HTML creatives without thumbnail: generate one
      if (type === 'html' && !thumbnailUrl) {
        try {
          const thumbRes = await api.generateHtmlThumbnail({ url, width: newPlacement.rect.width, height: newPlacement.rect.height })
          const generatedThumbnailUrl = thumbRes?.data?.data?.thumbnailUrl
          if (generatedThumbnailUrl) {
            newPlacement.thumbnailUrl = generatedThumbnailUrl
          }
        } catch (thumbErr) {
          console.warn('Thumbnail generation failed:', thumbErr)
        }
      }

      setPlacements(prev => [...prev.filter(p => p.id !== slot.id), newPlacement]);
      console.log('Upload completed successfully');
      setStatus('Creative uploaded successfully!');
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to upload creative';
      setError(errorMessage);
      setStatus(`❌ Upload failed: ${errorMessage}`);
    } finally {
      console.log('Setting busy to false and clearing timeout');
      clearTimeout(timeoutId);
      // Clear busy state immediately
      busyRef.current = false;
      setBusy(false);
      // Double-check after a brief delay to ensure it's cleared
      setTimeout(() => {
        if (busyRef.current !== false) {
          console.warn('Busy state was not cleared, forcing reset');
          busyRef.current = false;
          setBusy(false);
        }
      }, 100);
    }
  }, []);

  // If not busy and we have queued items, process next automatically
  useEffect(() => {
    if (!busy && uploadQueue.length > 0) {
      const next = uploadQueue[0];
      console.log('Processing queued upload:', next.file.name);
      setUploadQueue((prev) => prev.slice(1));
      // Kick off processing for queued item
      handleFileDrop(next.file, next.slot);
    }
  }, [busy, uploadQueue.length, handleFileDrop]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !pendingSlotRef.current) return;
    
    // Check if already busy
    if (busyRef.current || busy) {
      console.log('File change blocked - busy state:', { busyRef: busyRef.current, busy });
      setStatus('⏳ Upload in progress. Added to queue...');
      setUploadQueue((prev) => [...prev, { file, slot: pendingSlotRef.current }]);
      return;
    }
    
    // Validate file type (allow images, videos, HTML, ZIP files)
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isHtml = file.type === 'text/html' || file.type === 'application/xhtml+xml';
    const isZip = file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || 
                 file.name.toLowerCase().endsWith('.zip');
    
    if (!isImage && !isVideo && !isHtml && !isZip) {
      setStatus('❌ Unsupported file. Use image, video, HTML, or ZIP file.');
      return;
    }
    
    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setStatus('❌ File size too large. Please select a file smaller than 50MB.');
      return;
    }
    
    busyRef.current = true;
    setBusy(true);
    
    // Show loading state immediately for ZIP and HTML files
    if (isZip || isHtml) {
      const loadingPlacement = {
        id: pendingSlotRef.current.id,
        type: isZip ? 'zip' : 'html',
        isProcessing: true,
        processingMessage: isZip ? 'Loading ZIP...' : 'Loading HTML...',
        rect: { ...pendingSlotRef.current.position, width: pendingSlotRef.current.size?.width, height: pendingSlotRef.current.size?.height }
      };
      setPlacements(prev => [...prev.filter(p => p.id !== pendingSlotRef.current.id), loadingPlacement]);
    }
    
    setStatus('🔄 Uploading creative...');
    
    // Set a timeout to reset busy state if something goes wrong
    const timeoutId = setTimeout(() => {
      console.log('Upload timeout - resetting busy state');
      setBusy(false);
      setStatus('❌ Upload timeout - please try again');
    }, 60000); // 60 second timeout for ZIP/HTML processing
    
    try {
      console.log('Uploading file:', file.name, file.size, file.type);
      const form = new FormData();
      const slot = pendingSlotRef.current;
      
      let uploadRes;
      let data;
      
      if (isZip) {
        // Process ZIP file with ad frame dimensions
        form.append('zip', file);
        // Add ad frame dimensions to the form data
        if (slot && slot.size && slot.size.width && slot.size.height) {
          form.append('adFrameWidth', slot.size.width.toString());
          form.append('adFrameHeight', slot.size.height.toString());
          console.log(`Processing ZIP file with ad frame dimensions: ${slot.size.width}x${slot.size.height}px`);
        } else {
          console.log('Processing ZIP file (no frame dimensions available)');
        }
        uploadRes = await api.processZipAsset(form);
        data = uploadRes?.data?.data;
      } else if (isHtml) {
        // Process HTML file directly
        form.append('html', file);
        console.log('Processing HTML file...');
        uploadRes = await api.processHtmlAsset(form);
        data = uploadRes?.data?.data;
      } else {
        // Process regular assets (images, videos)
        form.append('asset', file);
        console.log('Processing regular asset...');
        uploadRes = await api.uploadAsset(form);
        data = uploadRes?.data?.data;
      }
      
      console.log('Upload response:', uploadRes);
      const url = data?.url || data?.imageUrl;
      const mimeType = data?.mimeType || file.type;
      if (!url) throw new Error('Upload failed - no url in response');
      
      let type = 'image';
      let htmlContent = null;
      // Only use thumbnailUrl for ZIPs/HTML, never for direct GIF uploads
      let thumbnailUrl = (isZip || isHtml) ? data?.thumbnailUrl : null;
      
      if (isZip) {
        // ZIP processing result
        type = data?.type || 'image';
        
        // Check if this is a direct image (single image ZIP)
        if (data?.isDirectImage) {
          console.log('Direct image from ZIP - treating as regular image asset');
          type = data?.type || 'image'; // Will be 'image' or 'gif'
          // No HTML content needed - image displays directly
        } else if (data?.bundledHtml) {
          // HTML-based ZIP with resources - might need bundled HTML
          try {
            const response = await fetch(data.bundledHtml);
            htmlContent = await response.text();
          } catch (error) {
            console.warn('Could not read bundled HTML content:', error);
          }
        }
      } else if (isHtml) {
        // HTML processing result - show the converted asset (GIF/PNG)
        type = data?.type === 'gif' ? 'gif' : 'image';
        if (data?.hasAnimations) {
          // For animated HTML, we might need to read the HTML content
          try {
            const response = await fetch(url);
            htmlContent = await response.text();
          } catch (error) {
            console.warn('Could not read HTML content:', error);
          }
        }
      } else {
        // Regular asset processing
        if (mimeType?.startsWith('video/')) type = 'video';
        else if (mimeType === 'image/gif') type = 'gif';
        else if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
          const isBundledHtml = file.name.includes('bundled') || file.name.includes('bundle');
          type = isBundledHtml ? 'bundled-html' : 'html';
        }
      }

      console.log('Adding placement:', { id: slot.id, url, type, rect: slot.position });
      
      let newPlacement = {
        id: slot.id,
        type,
        url,
        htmlContent,
        imageUrl: isImage ? url : undefined,
        thumbnailUrl: thumbnailUrl,
        rect: { ...slot.position, width: slot.size?.width, height: slot.size?.height }
      };

      // For HTML creatives without thumbnail: generate one
      if (type === 'html' && !thumbnailUrl) {
        try {
          const thumbRes = await api.generateHtmlThumbnail({ url, width: newPlacement.rect.width, height: newPlacement.rect.height })
          const generatedThumbnailUrl = thumbRes?.data?.data?.thumbnailUrl
          if (generatedThumbnailUrl) {
            newPlacement.thumbnailUrl = generatedThumbnailUrl
          }
        } catch (thumbErr) {
          console.warn('Thumbnail generation failed:', thumbErr)
        }
      }

      setPlacements(prev => [...prev.filter(p => p.id !== slot.id), newPlacement]);
      console.log('Upload completed successfully');
      setStatus('Ad replaced successfully!');
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to upload creative';
      setError(errorMessage);
      setStatus(`❌ Upload failed: ${errorMessage}`);
    } finally {
      console.log('Setting busy to false and clearing timeout');
      clearTimeout(timeoutId);
      // Clear busy state immediately
      busyRef.current = false;
      setBusy(false);
      pendingSlotRef.current = null;
      // Double-check after a brief delay to ensure it's cleared
      setTimeout(() => {
        if (busyRef.current !== false) {
          console.warn('Busy state was not cleared in handleFileChange, forcing reset');
          busyRef.current = false;
          setBusy(false);
        }
      }, 100);
    }
  }, []);

  // Helper function to calculate aspect-ratio-preserving dimensions
  const calculateAspectRatioDimensions = (imageWidth, imageHeight, containerWidth, containerHeight) => {
    const imageAspectRatio = imageWidth / imageHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let drawWidth, drawHeight, offsetX, offsetY;
    
    if (imageAspectRatio > containerAspectRatio) {
      // Image is wider - fit to width
      drawWidth = containerWidth;
      drawHeight = containerWidth / imageAspectRatio;
      offsetX = 0;
      offsetY = (containerHeight - drawHeight) / 2;
    } else {
      // Image is taller - fit to height
      drawHeight = containerHeight;
      drawWidth = containerHeight * imageAspectRatio;
      offsetX = (containerWidth - drawWidth) / 2;
      offsetY = 0;
    }
    
    return { drawWidth, drawHeight, offsetX, offsetY };
  };

  // Helper function to create a canvas from video/image with proper aspect ratio
  const createCanvasFromMedia = async (placement) => {
    const sourceUrl = placement.url || placement.imageUrl;
    if (!sourceUrl) return null;

    // Handle videos
    if (placement.type === 'video') {
      const videoElements = document.querySelectorAll('video[src="' + sourceUrl.replace(/"/g, '\\"') + '"]');
      if (videoElements.length > 0) {
        const video = videoElements[0];
        if (video.videoWidth && video.videoHeight) {
          const scale = 3; // High resolution
          const containerWidth = placement.rect.width * scale;
          const containerHeight = placement.rect.height * scale;
          
          const { drawWidth, drawHeight, offsetX, offsetY } = calculateAspectRatioDimensions(
            video.videoWidth,
            video.videoHeight,
            containerWidth,
            containerHeight
          );
          
          const canvas = document.createElement('canvas');
          canvas.width = containerWidth;
          canvas.height = containerHeight;
          const ctx = canvas.getContext('2d');
          
          // White background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw current video frame with aspect ratio
          ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
          
          return { 
            canvas, 
            width: placement.rect.width, 
            height: placement.rect.height,
            isHighRes: true
          };
        }
      }
    }
    
    // Handle GIFs and images
    let creative;
    const liveImgElements = document.querySelectorAll('img[src="' + sourceUrl.replace(/"/g, '\\"') + '"]');
    if (liveImgElements.length > 0 && (placement.type === 'gif' || sourceUrl.match(/\.gif$/i))) {
      creative = liveImgElements[0];
    } else {
      creative = new Image();
      creative.crossOrigin = 'anonymous';
      creative.src = sourceUrl;
      await new Promise((res, rej) => { 
        creative.onload = res; 
        creative.onerror = rej;
      });
    }
    
    return { 
      creative, 
      width: creative.naturalWidth, 
      height: creative.naturalHeight,
      isHighRes: false
    };
  };

  const handleFullPageDownload = useCallback(async () => {
    if (!screenshot) {
      setStatus('❌ No screenshot available to download');
      return;
    }
    
    setBusy(true);
    setIsScreenshotMode(true);
    setStatus('🔄 Preparing full page download...');
    
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = screenshot;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej });
      
      const base = document.createElement('canvas');
      base.width = img.naturalWidth;
      base.height = img.naturalHeight;
      const bctx = base.getContext('2d');
      bctx.drawImage(img, 0, 0);
      
      // Add overlays if any
      for (const p of placements) {
        try {
          const mediaData = await createCanvasFromMedia(p);
          if (!mediaData) {
            console.warn('Skipping placement without media:', p);
            continue;
          }
          
          const source = mediaData.canvas || mediaData.creative;
          const sourceWidth = mediaData.isHighRes ? mediaData.width : source.naturalWidth || source.width;
          const sourceHeight = mediaData.isHighRes ? mediaData.height : source.naturalHeight || source.height;
          
          // Calculate aspect-ratio-preserving dimensions
          const { drawWidth, drawHeight, offsetX, offsetY } = calculateAspectRatioDimensions(
            sourceWidth,
            sourceHeight,
            p.rect.width,
            p.rect.height
          );
          
          // Fill background with white
          bctx.fillStyle = '#ffffff';
          bctx.fillRect(p.rect.x, p.rect.y, p.rect.width, p.rect.height);
          
          // Draw the media centered with preserved aspect ratio
          bctx.drawImage(
            source,
            p.rect.x + offsetX,
            p.rect.y + offsetY,
            drawWidth,
            drawHeight
          );
        } catch (overlayError) {
          console.warn('Failed to add overlay:', overlayError);
          // Continue with other overlays
        }
      }
      
      const dataUrl = base.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `full-page-screenshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('✅ Full page screenshot downloaded successfully!');
    } catch (e) {
      console.error('Download failed', e);
      setError('Download failed');
      setStatus('❌ Failed to download screenshot. Please try again.');
    } finally {
      setBusy(false);
      setIsScreenshotMode(false);
    }
  }, [placements, screenshot]);

  const handleViewportDownload = useCallback(async () => {
    if (!screenshot) {
      setStatus('❌ No screenshot available to download');
      return;
    }
    
    setBusy(true);
    setIsScreenshotMode(true);
    setStatus('🔄 Preparing viewport download...');
    
    try {
      // Check if sticky header is enabled and get header data
      const stickyHeaderElement = document.querySelector('.sticky-header');
      const header = deviceHeaders[selectedDevice];
      const isStickyHeaderEnabled = stickyHeaderElement && header && header.headerUrl;
      
      // Draw base screenshot and overlays to a full-size canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = screenshot;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej });
      
      const base = document.createElement('canvas');
      base.width = img.naturalWidth;
      base.height = img.naturalHeight;
      const bctx = base.getContext('2d');
      bctx.drawImage(img, 0, 0);
      
      // Add overlays to the base canvas
      for (const p of placements) {
        try {
          const mediaData = await createCanvasFromMedia(p);
          if (!mediaData) {
            console.warn('Skipping placement without media:', p);
            continue;
          }
          
          const source = mediaData.canvas || mediaData.creative;
          const sourceWidth = mediaData.isHighRes ? mediaData.width : source.naturalWidth || source.width;
          const sourceHeight = mediaData.isHighRes ? mediaData.height : source.naturalHeight || source.height;
          
          // Calculate aspect-ratio-preserving dimensions
          const { drawWidth, drawHeight, offsetX, offsetY } = calculateAspectRatioDimensions(
            sourceWidth,
            sourceHeight,
            p.rect.width,
            p.rect.height
          );
          
          // Fill background with white
          bctx.fillStyle = '#ffffff';
          bctx.fillRect(p.rect.x, p.rect.y, p.rect.width, p.rect.height);
          
          // Draw the media centered with preserved aspect ratio
          bctx.drawImage(
            source,
            p.rect.x + offsetX,
            p.rect.y + offsetY,
            drawWidth,
            drawHeight
          );
        } catch (overlayError) {
          console.warn('Failed to add overlay:', overlayError);
          // Continue with other overlays
        }
      }
      
      // Find the correct scroll container
      const displayImg = screenshotRef.current;
      let container = document.querySelector('.viewport');
      
      // If viewport doesn't have scroll, check parent containers
      if (!container || (container.scrollTop === 0 && container.scrollLeft === 0)) {
        // Check if the image's parent container has scroll
        const imageParent = displayImg?.parentElement;
        if (imageParent && (imageParent.scrollTop > 0 || imageParent.scrollLeft > 0)) {
          container = imageParent;
        }
      }
      
      // If still no scroll, check the preview section container
      if (!container || (container.scrollTop === 0 && container.scrollLeft === 0)) {
        const previewSection = document.querySelector('.flex-1.p-4.overflow-auto');
        if (previewSection && (previewSection.scrollTop > 0 || previewSection.scrollLeft > 0)) {
          container = previewSection;
        }
      }
      
      // Final fallback: find any scrollable container in the hierarchy
      if (!container || (container.scrollTop === 0 && container.scrollLeft === 0)) {
        let currentElement = displayImg?.parentElement;
        while (currentElement && currentElement !== document.body) {
          const computedStyle = window.getComputedStyle(currentElement);
          const hasScroll = currentElement.scrollTop > 0 || currentElement.scrollLeft > 0;
          const isScrollable = computedStyle.overflow === 'auto' || 
                              computedStyle.overflow === 'scroll' || 
                              computedStyle.overflowY === 'auto' || 
                              computedStyle.overflowY === 'scroll';
          
          if (hasScroll && isScrollable) {
            container = currentElement;
            console.log('Found scrollable container:', currentElement.className, {
              scrollTop: currentElement.scrollTop,
              scrollLeft: currentElement.scrollLeft
            });
            break;
          }
          currentElement = currentElement.parentElement;
        }
      }
      
      if (!container) {
        throw new Error('No scrollable container found');
      }
      
      // Debug scroll information
      console.log('Scroll Debug Info:', {
        containerClass: container.className,
        containerScrollLeft: container.scrollLeft,
        containerScrollTop: container.scrollTop,
        containerClientWidth: container.clientWidth,
        containerClientHeight: container.clientHeight,
        containerScrollWidth: container.scrollWidth,
        containerScrollHeight: container.scrollHeight,
        displayImgWidth: displayImg?.clientWidth,
        displayImgHeight: displayImg?.clientHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        isStickyHeaderEnabled
      });
      
      const scale = img.naturalWidth / (displayImg?.clientWidth || img.naturalWidth);
      const sx = Math.max(0, Math.floor(container.scrollLeft * scale));
      const sy = Math.max(0, Math.floor(container.scrollTop * scale));
      const sw = Math.min(base.width - sx, Math.floor(container.clientWidth * scale));
      const sh = Math.min(base.height - sy, Math.floor(container.clientHeight * scale));
      
      // Calculate header height in canvas coordinates if sticky header is enabled
      let headerHeightInCanvas = 0;
      let headerImage = null;
      
      if (isStickyHeaderEnabled && header.headerHeight) {
        // Load header image
        headerImage = new Image();
        headerImage.crossOrigin = 'anonymous';
        headerImage.src = header.headerUrl;
        await new Promise((res, rej) => { 
          headerImage.onload = res; 
          headerImage.onerror = rej;
        });
        
        // Calculate header height in canvas coordinates based on viewport scale
        const headerElement = stickyHeaderElement.querySelector('img');
        if (headerElement) {
          const headerDisplayHeight = headerElement.clientHeight;
          headerHeightInCanvas = Math.floor((headerDisplayHeight / container.clientHeight) * sh);
        } else {
          // Fallback: use header height from metadata, scaled to canvas
          headerHeightInCanvas = Math.floor((header.headerHeight / container.clientHeight) * sh);
        }
      }
      
      console.log('Crop Debug Info:', {
        scale,
        sx,
        sy,
        sw,
        sh,
        baseWidth: base.width,
        baseHeight: base.height,
        headerHeightInCanvas,
        isStickyHeaderEnabled
      });
      
      // Create output canvas - maintain viewport height (aspect ratio)
      // If header is enabled, header takes space from top, reducing screenshot height
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh; // Keep same height as viewport to maintain aspect ratio
      const octx = out.getContext('2d');
      
      // Fill background with white
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, out.width, out.height);
      
      // Draw header at the top if sticky header is enabled
      if (isStickyHeaderEnabled && headerImage && headerHeightInCanvas > 0) {
        // Calculate header width and position in canvas coordinates
        const headerElement = stickyHeaderElement.querySelector('img');
        const headerDisplayWidth = headerElement?.clientWidth || header.headerWidth || sw;
        const headerDisplayHeight = headerElement?.clientHeight || header.headerHeight;
        
        // Scale header to match canvas dimensions
        const headerScaleX = sw / container.clientWidth;
        const headerCanvasWidth = Math.floor(headerDisplayWidth * headerScaleX);
        const headerCanvasHeight = headerHeightInCanvas;
        
        // Calculate header X position in canvas coordinates
        const headerX = header.headerX !== undefined 
          ? Math.floor((header.headerX / (selectedDevice === 'macbook-air' ? 1440 : 393)) * sw)
          : 0;
        
        // Draw header image at the top
        octx.drawImage(
          headerImage,
          headerX,
          0,
          headerCanvasWidth,
          headerCanvasHeight
        );
        
        // Draw viewport content below the header, cropped from top
        // Crop the top portion (header height) from the screenshot and draw the rest below header
        // headerHeightInCanvas is already in source coordinates (same scale as sh)
        const screenshotHeight = sh - headerHeightInCanvas;
        // Source: start reading from (sx, sy + headerHeightInCanvas) to skip top portion
        // Destination: draw at (0, headerHeightInCanvas) with full width and remaining height
        const sourceY = sy + headerHeightInCanvas; // Crop top portion in source coordinates
        const sourceHeight = sh - headerHeightInCanvas; // Remaining height after crop
        octx.drawImage(base, sx, sourceY, sw, sourceHeight, 0, headerHeightInCanvas, sw, screenshotHeight);
      } else {
        // No header: draw full viewport content
        octx.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      
      const dataUrl = out.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `viewport-screenshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('✅ Viewport screenshot downloaded successfully!');
    } catch (e) {
      console.error('Viewport download failed', e);
      setError('Viewport download failed');
      setStatus('❌ Failed to download viewport screenshot. Please try again.');
    } finally {
      setBusy(false);
      setIsScreenshotMode(false);
    }
  }, [placements, screenshot, screenshotRef, deviceHeaders, selectedDevice]);

  const handleDeviceScreenshot = useCallback(async () => {
    if (!screenshot) {
      setStatus('❌ No screenshot available to download');
      return;
    }
    
    setBusy(true);
    setIsScreenshotMode(true); // Hide ad overlays during capture
    setStatus('🔄 Capturing device with live content...');
    
    // Small delay to ensure DOM updates before capture
    await new Promise(resolve => setTimeout(resolve, 100));
    
    let originalPaddingBottom = null;
    try {
      const terminalDiv = document.querySelector('.terminal');
      if (!terminalDiv) {
        throw new Error('Terminal div not found');
      }
      
      // Add bottom padding to time element for html2canvas positioning
      const timeElementForCapture = terminalDiv.querySelector('.time-header-element');
      if (timeElementForCapture) {
        originalPaddingBottom = timeElementForCapture.style.paddingBottom || '';
        timeElementForCapture.style.paddingBottom = '15px';
      }
      
      // Find all video and image elements and temporarily replace with canvas overlays
      const videos = document.querySelectorAll('video');
      const images = document.querySelectorAll('img');
      const replacements = [];
      
      // Process videos
      videos.forEach((video) => {
        if (video.videoWidth && video.videoHeight) {
          const parent = video.parentElement;
          
          // Calculate dimensions for object-fit: contain within parent
          const containerWidth = video.offsetWidth;
          const containerHeight = video.offsetHeight;
          const videoAspect = video.videoWidth / video.videoHeight;
          const containerAspect = containerWidth / containerHeight;
          
          let drawWidth, drawHeight, drawX, drawY;
          
          if (videoAspect > containerAspect) {
            // Video is wider - fit to width
            drawWidth = containerWidth;
            drawHeight = containerWidth / videoAspect;
            drawX = 0;
            drawY = (containerHeight - drawHeight) / 2;
          } else {
            // Video is taller - fit to height
            drawHeight = containerHeight;
            drawWidth = containerHeight * videoAspect;
            drawX = (containerWidth - drawWidth) / 2;
            drawY = 0;
          }
          
          // Create high-resolution canvas (3x for better quality)
          const scale = 3;
          const canvas = document.createElement('canvas');
          canvas.width = containerWidth * scale;
          canvas.height = containerHeight * scale;
          const ctx = canvas.getContext('2d');
          
          // White background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw video frame with proper aspect ratio at high resolution
          ctx.drawImage(video, drawX * scale, drawY * scale, drawWidth * scale, drawHeight * scale);
          
          // Style canvas to match video
          canvas.style.position = 'absolute';
          canvas.style.left = video.style.left || '0';
          canvas.style.top = video.style.top || '0';
          canvas.style.width = video.style.width || '100%';
          canvas.style.height = video.style.height || '100%';
          canvas.style.objectFit = 'contain';
          canvas.style.display = 'block';
          canvas.style.margin = video.style.margin || 'auto';
          canvas.style.zIndex = '9999';
          
          // Hide video and insert canvas
          video.style.visibility = 'hidden';
          parent.insertBefore(canvas, video);
          
          replacements.push({ element: video, canvas });
        }
      });
      
      // Process images (including GIFs)
      images.forEach((img) => {
        if (img.naturalWidth && img.naturalHeight && img.complete) {
          const parent = img.parentElement;
          
          // Skip if image is not in a placement container
          if (!parent || !parent.style.position) return;
          
          // Calculate dimensions for object-fit: contain within parent
          const containerWidth = img.offsetWidth;
          const containerHeight = img.offsetHeight;
          const imgAspect = img.naturalWidth / img.naturalHeight;
          const containerAspect = containerWidth / containerHeight;
          
          let drawWidth, drawHeight, drawX, drawY;
          
          if (imgAspect > containerAspect) {
            // Image is wider - fit to width
            drawWidth = containerWidth;
            drawHeight = containerWidth / imgAspect;
            drawX = 0;
            drawY = (containerHeight - drawHeight) / 2;
          } else {
            // Image is taller - fit to height
            drawHeight = containerHeight;
            drawWidth = containerHeight * imgAspect;
            drawX = (containerWidth - drawWidth) / 2;
            drawY = 0;
          }
          
          // Create high-resolution canvas (3x for better quality)
          const scale = 3;
          const canvas = document.createElement('canvas');
          canvas.width = containerWidth * scale;
          canvas.height = containerHeight * scale;
          const ctx = canvas.getContext('2d');
          
          // White background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw image with proper aspect ratio at high resolution
          ctx.drawImage(img, drawX * scale, drawY * scale, drawWidth * scale, drawHeight * scale);
          
          // Style canvas to match image
          canvas.style.position = 'absolute';
          canvas.style.left = img.style.left || '0';
          canvas.style.top = img.style.top || '0';
          canvas.style.width = img.style.width || '100%';
          canvas.style.height = img.style.height || '100%';
          canvas.style.objectFit = 'contain';
          canvas.style.display = 'block';
          canvas.style.margin = img.style.margin || 'auto';
          canvas.style.zIndex = '9999';
          
          // Hide image and insert canvas
          img.style.visibility = 'hidden';
          parent.insertBefore(canvas, img);
          
          replacements.push({ element: img, canvas });
        }
      });
      
      // Calculate scrollbar width to account for Windows scrollbars
      const getScrollbarWidth = () => {
        const outer = document.createElement('div');
        outer.style.visibility = 'hidden';
        outer.style.overflow = 'scroll';
        outer.style.msOverflowStyle = 'scrollbar'; // Needed for IE
        document.body.appendChild(outer);
        
        const inner = document.createElement('div');
        outer.appendChild(inner);
        
        const scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
        outer.parentNode?.removeChild(outer);
        return scrollbarWidth;
      };
      
      const scrollbarWidth = getScrollbarWidth();
      
      // Temporarily hide scrollbars during capture to prevent positioning issues
      const viewportElement = terminalDiv.querySelector('.viewport');
      const originalOverflow = viewportElement?.style.overflow;
      const originalOverflowY = viewportElement?.style.overflowY;
      if (viewportElement) {
        viewportElement.style.overflow = 'hidden';
        viewportElement.style.overflowY = 'hidden';
      }
      
      // Now capture with html2canvas at high resolution
      const html2canvas = (await import('html2canvas')).default;
      const deviceCanvas = await html2canvas(terminalDiv, {
        backgroundColor: null,
        scale: 3, // Higher resolution for better quality
        useCORS: true,
        logging: false,
        imageTimeout: 0,
        allowTaint: true,
        letterRendering: true, // Better text rendering
        foreignObjectRendering: false, // Use native rendering for better text positioning
        scrollX: 0, // Ensure no horizontal scroll offset
        scrollY: 0 // Ensure no vertical scroll offset
      });
      
      // Restore scrollbars after capture
      if (viewportElement) {
        viewportElement.style.overflow = originalOverflow || '';
        viewportElement.style.overflowY = originalOverflowY || '';
      }
      
      // Clean up: remove canvases and restore original elements
      replacements.forEach(({ element, canvas }) => {
        canvas.remove();
        element.style.visibility = 'visible';
      });
      
      // Restore original padding on time element
      const timeElementForRestore = terminalDiv.querySelector('.time-header-element');
      if (timeElementForRestore && originalPaddingBottom !== null) {
        timeElementForRestore.style.paddingBottom = originalPaddingBottom;
      }
      
      // Download the final composite
      deviceCanvas.toBlob((blob) => {
        if (!blob) {
          throw new Error('Failed to create image blob');
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `device-screenshot-${selectedDevice}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
      
      setStatus('✅ Device screenshot captured with aspect ratio preserved!');
    } catch (e) {
      console.error('Device screenshot failed:', e);
      setError('Device screenshot failed');
      setStatus('❌ Failed to download device screenshot. Please try again.');
      
      // Clean up on error
      document.querySelectorAll('video').forEach(v => v.style.visibility = 'visible');
      document.querySelectorAll('canvas[style*="z-index: 9999"]').forEach(c => c.remove());
    } finally {
      setBusy(false);
      setIsScreenshotMode(false); // Restore ad overlays
    }
  }, [screenshot, selectedDevice, placements]);

  const onImageLoad = () => {
    if (screenshotRef.current) {
      const newSize = {
        width: screenshotRef.current.naturalWidth,
        height: screenshotRef.current.naturalHeight,
      };
      console.log(`[MainInterface] Image loaded - setting imageSize:`, newSize);
      console.log(`[MainInterface] Image src:`, screenshotRef.current.src);
      console.log(`[MainInterface] Image complete:`, screenshotRef.current.complete);
      setImageSize(newSize);
    } else {
      console.warn(`[MainInterface] onImageLoad called but screenshotRef.current is null`);
    }
  };

  return (
    <div className="h-screen bg-gray-50 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="px-6 py-3">
          <div className="flex items-center justify-center">
            {/* Title - Centered */}
            <div className="text-center">
                    <h1 className="text-3xl font-brand text-gray-900 tracking-tight leading-tight">
                      AdForge
                    </h1>
                    <p className="text-sm text-gray-600 mt-1 font-light tracking-wide">
                      Upload a URL, detect ads, and replace them with your creative assets
                    </p>
                  </div>

            {/* Profile - Right */}
            <div className="absolute right-6 flex items-center">
              <div className="relative">
                <button
                  type="button"
                  className="w-9 h-9 rounded-full bg-black text-white border border-white flex items-center justify-center font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
                  onClick={() => setProfileOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                >
                  {(() => {
                    const name = (user?.full_name || user?.email || '').trim();
                    const parts = name ? name.split(/\s+/) : [];
                    const initials = (parts[0]?.[0] || '') + (parts[1]?.[0] || (parts.length === 1 ? parts[0]?.[1] || '' : ''));
                    return (initials || 'U').toUpperCase();
                  })()}
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-50">
                    <div className="p-4 border-b">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-semibold border border-white">
                          {(() => {
                            const name = (user?.full_name || user?.email || '').trim();
                            const parts = name ? name.split(/\s+/) : [];
                            const initials = (parts[0]?.[0] || '') + (parts[1]?.[0] || (parts.length === 1 ? parts[0]?.[1] || '' : ''));
                            return (initials || 'U').toUpperCase();
                          })()}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{user?.full_name || user?.email}</div>
                          {user?.email && <div className="text-xs text-gray-500">{user.email}</div>}
                        </div>
                      </div>
                    </div>
                    <div className="p-2 space-y-1">
                      <button
                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-sm text-gray-700"
                        onClick={async () => {
                          setProfileOpen(false);
                          if (user?.email) {
                            try {
                              await api.purgeCache(user.email);
                              setStatus('✅ Cache purged successfully');
                            } catch (error) {
                              console.error('Error purging cache:', error);
                              setStatus('⚠️ Failed to purge cache');
                            }
                          }
                        }}
                      >
                        Purge Cache
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-sm text-gray-700"
                        onClick={() => {
                          setProfileOpen(false);
                          logout();
                        }}
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification Overlay */}
      {status && (
        <div className="fixed top-4 right-4 z-50 max-w-sm">
          <div className={`p-4 rounded-lg shadow-lg border-l-4 transform transition-all duration-500 ease-in-out ${
            status.includes('successfully') || status.includes('Detected') || status.includes('✅')
              ? 'bg-green-50 border-green-500 text-green-800' 
              : status.includes('Error') || status.includes('❌')
              ? 'bg-red-50 border-red-500 text-red-800'
              : status.includes('🔄') || status.includes('Loading')
              ? 'bg-blue-50 border-blue-500 text-blue-800'
              : 'bg-yellow-50 border-yellow-500 text-yellow-800'
          } animate-slide-in-right`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  status.includes('successfully') || status.includes('Detected') || status.includes('✅')
                    ? 'bg-green-500' 
                    : status.includes('Error') || status.includes('❌')
                    ? 'bg-red-500'
                    : status.includes('🔄') || status.includes('Loading')
                    ? 'bg-blue-500'
                    : 'bg-yellow-500'
                }`}>
                  {status.includes('successfully') || status.includes('Detected') || status.includes('✅') ? (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : status.includes('Error') || status.includes('❌') ? (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  ) : status.includes('🔄') || status.includes('Loading') ? (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold text-sm ${
                    status.includes('successfully') || status.includes('Detected') || status.includes('✅')
                      ? 'text-green-800' 
                      : status.includes('Error') || status.includes('❌')
                      ? 'text-red-800'
                      : status.includes('🔄') || status.includes('Loading')
                      ? 'text-blue-800'
                      : 'text-yellow-800'
                  }`}>
                    {status.includes('successfully') || status.includes('Detected') || status.includes('✅') ? 'Success' : 
                     status.includes('Error') || status.includes('❌') ? 'Error' :
                     status.includes('🔄') || status.includes('Loading') ? 'Loading' : 'Warning'}
                  </div>
                  <div className={`text-xs mt-1 leading-relaxed ${
                    status.includes('successfully') || status.includes('Detected') || status.includes('✅')
                      ? 'text-green-700' 
                      : status.includes('Error') || status.includes('❌')
                      ? 'text-red-700'
                      : status.includes('🔄') || status.includes('Loading')
                      ? 'text-blue-700'
                      : 'text-yellow-700'
                  }`}>
                    {status}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setStatus('')}
                className="flex-shrink-0 ml-3 text-gray-400 hover:text-gray-600 transition-colors duration-200 hover:bg-gray-200 rounded-full p-1"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - Three Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - URL Input and Instructions */}
        <div className="w-80 bg-white shadow-lg border-r flex flex-col">
          <div className="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
            <UrlSection
              webpageUrl={webpageUrl}
              setWebpageUrl={setWebpageUrl}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              buttonState={buttonState}
              handlePreviewUrl={handlePreviewUrl}
              handleDeviceChange={handleDeviceChange}
              isLoading={isLoading}
              isPreloading={isPreloading}
              detectedAds={detectedAds}
              handleOverlayClick={handleOverlayClick}
            />
          </div>
        </div>

        {/* Center Panel - Screenshot Preview */}
        <div className="flex-1 bg-white shadow-lg border-r overflow-hidden flex flex-col min-h-0">
          <PreviewSection
            screenshot={screenshot}
            selectedDevice={selectedDevice}
            detectedAds={detectedAds}
            imageSize={imageSize}
            placements={placements}
            handleOverlayClick={handleOverlayClick}
            handleFileDrop={handleFileDrop}
            handleFullPageDownload={handleFullPageDownload}
            handleViewportDownload={handleViewportDownload}
            handleDeviceScreenshot={handleDeviceScreenshot}
            onImageLoad={onImageLoad}
            screenshotRef={screenshotRef}
            onThumbnail={(id, url) => {
              setPlacements(prev => prev.map(p => p.id === id ? { ...p, thumbnailUrl: url } : p))
            }}
            isScreenshotMode={isScreenshotMode}
            isLoading={isLoading || isPreloading}
            webpageUrl={webpageUrl}
            header={deviceHeaders[selectedDevice]}
          />
        </div>

      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.html,text/html,.zip,application/zip"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};

export default MainInterface;
