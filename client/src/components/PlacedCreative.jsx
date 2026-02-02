import React, { useEffect, useMemo, useRef, useState } from 'react'

const PlacedCreative = ({ placement, imageNaturalSize, onThumbnail, isScreenshotMode = false }) => {
  const style = useMemo(() => {
    const iw = imageNaturalSize?.width || 1
    const ih = imageNaturalSize?.height || 1

    // Ad div dimensions in pixels
    const adLeftPx = (placement.rect?.x || 0)
    const adTopPx = (placement.rect?.y || 0)
    const adWidthPx = (placement.rect?.width || 0)
    const adHeightPx = (placement.rect?.height || 0)

    // Convert to percentages relative to the full image
    const leftPct = (adLeftPx / iw) * 100
    const topPct = (adTopPx / ih) * 100
    const widthPct = (adWidthPx / iw) * 100
    const heightPct = (adHeightPx / ih) * 100

    return {
      position: 'absolute',
      left: `${leftPct}%`,
      top: `${topPct}%`,
      width: `${widthPct}%`,
      height: `${heightPct}%`,
      backgroundColor: '#ffffff', // White background behind creatives
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none'
    }
  }, [placement, imageNaturalSize])

  const commonMediaStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    margin: 'auto'
  }

  const type = placement.type || (placement.imageUrl ? 'image' : 'custom')
  const iframeRef = useRef(null)
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState(placement.thumbnailUrl)
  
  // Handle different asset types
  const getDisplayUrl = () => {
    // ALWAYS use the actual asset (GIF/image/video)
    // html2canvas will capture the live GIF frame when screenshot is taken
    return placement.url || placement.imageUrl;
  }

  // If HTML creative: try to extract body background-image as thumbnail
  useEffect(() => {
    if (type !== 'html') return
    const iframe = iframeRef.current
    if (!iframe) return

    const onLoad = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document
        if (!doc) return
        const body = doc.body
        if (!body) return
        const style = iframe.contentWindow?.getComputedStyle(body)
        const bgImage = style?.backgroundImage || ''
        const match = /url\((['\"]?)(.*?)\1\)/.exec(bgImage || '')
        const rawUrl = match?.[2]
        if (rawUrl) {
          const base = new URL(placement.url, window.location.origin)
          const abs = new URL(rawUrl, base).toString()
          setHtmlPreviewUrl(abs)
          if (onThumbnail) onThumbnail(placement.id, abs)
        }
      } catch (_) {
        // Cross-origin or other access issues: skip
      }
    }

    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [type, placement?.url, placement?.id, onThumbnail])

  const displayUrl = getDisplayUrl()
  
  // Show loading state for processing assets (hide during screenshots)
  if (placement.isProcessing) {
    if (isScreenshotMode) {
      return null
    }
    return (
      <div style={style}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          backgroundColor: 'white',
          border: 'none',
          color: '#6b7280',
          fontSize: '12px',
          textAlign: 'center',
          padding: '8px'
        }}>
          <div style={{ marginBottom: '4px' }}>⏳</div>
          <div>{placement.processingMessage || "Processing..."}</div>
        </div>
      </div>
    )
  }
  
  return (
    <div style={style}>
      {type === 'image' && (
        <img src={displayUrl} alt="creative" style={commonMediaStyle} />
      )}
      {type === 'gif' && (
        <img src={displayUrl} alt="creative" style={commonMediaStyle} />
      )}
      {type === 'video' && (
        <video src={placement.url} style={commonMediaStyle} autoPlay loop muted playsInline />
      )}
      {type === 'html' && (
        htmlPreviewUrl ? (
          <img src={htmlPreviewUrl} alt="html-preview" style={commonMediaStyle} />
        ) : (
          <iframe 
            ref={iframeRef} 
            src={placement.url} 
            style={{ 
              width: '100%', 
              height: '100%', 
              border: 'none',
              backgroundColor: 'transparent'
            }}
            sandbox="allow-scripts allow-same-origin"
            title="HTML Creative"
          />
        )
      )}
      {type === 'bundled-html' && (
        <iframe 
          srcDoc={placement.htmlContent || placement.url} 
          style={{ 
            width: '100%', 
            height: '100%', 
            border: 'none',
            backgroundColor: 'transparent'
          }}
          sandbox="allow-scripts allow-same-origin"
          title="Bundled HTML Creative"
        />
      )}
      {type === 'zip' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          backgroundColor: '#f3f4f6',
          border: '2px dashed #9ca3af',
          borderRadius: '4px',
          color: '#6b7280',
          fontSize: '12px',
          textAlign: 'center',
          padding: '8px'
        }}>
          <div style={{ marginBottom: '4px' }}>📦</div>
          <div>ZIP Processing...</div>
        </div>
      )}
      {type === 'zip-processed' && (
        // For processed ZIP assets, show the converted asset (GIF/PNG)
        <img src={displayUrl} alt="zip-processed-creative" style={commonMediaStyle} />
      )}
      {type === 'custom' && placement.render && placement.render()}
    </div>
  )
}

export default PlacedCreative
