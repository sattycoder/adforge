import React, { useEffect, useMemo, useRef, useState } from 'react'
import Iphone16 from '../assets/Iphone16.png'
import MacBookAir from '../assets/MacBookAir.png'

const TERMINAL_SPECS = {
  'iphone16': {
    bg: Iphone16,
    artboard: { width: 360, height: 742 },
    viewport: { width: 328, height: 711, top: 14, left: 16, radius: 42}
  },
  'macbook-air': {
    bg: MacBookAir,
    artboard: { width: 1648, height: 947 },
    viewport: { width: 1280, height: 800, top: 56, left: 184, radius: 0 }
  }
}

const DeviceFrame = ({ device = 'macbook-air', children }) => {
  const spec = useMemo(() => TERMINAL_SPECS[device] || TERMINAL_SPECS['macbook-air'], [device])

  // Measure available space inside the parent container to avoid cropping
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [frameSize, setFrameSize] = useState({ width: spec.artboard.width, height: spec.artboard.height, margins: { top: 0, right: 0, bottom: 0, left: 0 } })

  useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setContainerSize({ width, height })
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // Compute frame (device artboard) size based on container and device-specific margins
  useEffect(() => {
    const aspect = spec.artboard.width / spec.artboard.height
    const { width: cw, height: ch } = containerSize
    if (!cw || !ch) return

    if (device === 'iphone16') {
      const margins = { top: 10, right: 0, bottom: 30, left: 0 }
      // Prefer fitting height first (respecting top/bottom margins)
      const maxHeight = Math.max(0, ch - margins.top - margins.bottom)
      let height = maxHeight
      let width = Math.round(height * aspect)
      // If too wide, clamp by container width
      if (width > cw) {
        width = cw
        height = Math.round(width / aspect)
      }
      setFrameSize({ width, height, margins })
    } else {
      // macbook-air - fit width first with side margins, then clamp to height if needed
      const margins = { top: 20, right: 15, bottom: 0, left: 15 }
      const maxWidth = Math.max(0, cw - margins.left - margins.right)
      let width = maxWidth
      let height = Math.round(width / aspect)
      const maxHeight = Math.max(0, ch - margins.top - margins.bottom)
      if (height > maxHeight) {
        height = maxHeight
        width = Math.round(height * aspect)
      }
      setFrameSize({ width, height, margins })
    }
  }, [containerSize, device, spec.artboard.height, spec.artboard.width])

  const wrapperClass = 'w-full h-full relative'
  const outerStyle = {
    position: 'absolute',
    top: `${frameSize.margins.top}px`,
    left: '50%',
    transform: 'translateX(-50%)',
    width: `${frameSize.width}px`,
    height: `${frameSize.height}px`,
  }

  const deviceStyle = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url(${spec.bg})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%'
  }


  

  // Optional iPhone header bar overlay (non-interactive, for look & feel)
  const scale = frameSize.width / spec.artboard.width || 1
  // Scale corner radius with frame size and clamp to header height so curvature matches
  const scaledRadiusRaw = Math.max(0, Math.round((spec.viewport.radius || 0) * scale))
  const showHeader = device === 'iphone16'
  const baseHeaderHeight = 40
  const headerHeightPx = showHeader ? Math.max(32, Math.round(baseHeaderHeight+3 * scale * 0.69)) : 0
  const scaledRadius = Math.min(scaledRadiusRaw, Math.floor(headerHeightPx/0.69))
  const headerStyle = showHeader ? {
    position: 'absolute',
    top: `${(spec.viewport.top / spec.artboard.height) * 100}%`,
    left: `${(spec.viewport.left / spec.artboard.width) * 100}%`,
    width: `${(spec.viewport.width / spec.artboard.width) * 100}%`,
    height: `${(headerHeightPx / spec.artboard.height) * 100}%`,
    backgroundColor: 'rgb(24, 22, 23)',
    borderBottom: '1px solidrgb(24, 22, 23)',
    pointerEvents: 'none',
    zIndex: 2,
    borderTopLeftRadius: `${scaledRadius}px`,
    borderTopRightRadius: `${scaledRadius}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: 'white',
    fontSize: `${Math.max(10, Math.round(16 * scale))}px`,
    padding: `0 ${Math.max(4, Math.round(8 * scale))}px`,
    boxSizing: 'border-box',
    margin: 0,
    lineHeight: 'normal'
  } : null

  const headerHeight = headerHeightPx

  const viewportStyle = {
    position: 'absolute',
    top: `${((spec.viewport.top + headerHeight) / spec.artboard.height) * 100}%`, // shifted down
    left: `${(spec.viewport.left / spec.artboard.width) * 100}%`,
    width: `${(spec.viewport.width / spec.artboard.width) * 100}%`,
    height: `${((spec.viewport.height - headerHeight) / spec.artboard.height) * 100}%`, // reduced height
    overflow: 'auto',
    overflowX: 'hidden', // Prevent horizontal scrollbar
    borderRadius: `0 0 ${scaledRadius}px ${scaledRadius}px`,
    background: 'transparent',
    scrollbarWidth: 'none', // Firefox - hide scrollbar completely
    msOverflowStyle: 'none' // IE and Edge - hide scrollbar completely
  }

  return (
    <div ref={containerRef} className={wrapperClass}>
      <div style={outerStyle} className="terminal">
        <div className="terminal-object" style={deviceStyle} />
        {showHeader && (
          <header
  className="header-component smartphone apple-iphone-16-2024 dark"
  style={headerStyle}
>
  {/* Time */}
  <div
    className="time-header-element"
    style={{
      display: "flex",
      gap: 0,
      alignItems: "center",
      paddingLeft: Math.max(6, Math.round(12 * scale)),
      paddingRight: Math.max(5, Math.round(10 * scale)),
    }}
  >
    <div
      style={{
        fontWeight: 500,
        fontSize: `${Math.max(8, Math.round((13 * (scale*1.08))+2))}px`,
        height: `${Math.max(8, Math.round(12 * (scale*1.08)))}px`,
        display: "flex",
        alignItems: "center",
        margin: 0,
        padding: 0,
    }}
  >
    {new Date().toLocaleTimeString([], {
        paddingTop: Math.max(2, Math.round(4 * scale)),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}
  </div>
  </div>

  {/* Network/WiFi/Battery icons */}
  <div
    style={{
      display: "flex",
      gap: Math.max(3, Math.round(5 * scale)),
      alignItems: "center",
      paddingRight: Math.max(6, Math.round(12 * scale)),
    }}
  >
    {/* Signal icon */}
    <svg
      height={`${Math.max(8, Math.round(12 * scale))}`}
      viewBox="0 0 12 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity: 0.9 }}
    >
      <path
        d="
        M0.5 7.5 H2.0 V5.4 
        Q2.0 5.2 1.25 5.2 Q0.5 5.2 0.5 5.4 Z
        
        M3.3 7.5 H4.8 V3.9 
        Q4.8 3.7 4.05 3.7 Q3.3 3.7 3.3 3.9 Z
        
        M6.1 7.5 H7.6 V2.4 
        Q7.6 2.2 6.85 2.2 Q6.1 2.2 6.1 2.4 Z
        
        M8.9 7.5 H10.4 V0.9 
        Q10.4 0.7 9.65 0.7 Q8.9 0.7 8.9 0.9 Z"        
     
        fill="white"
      />
    </svg>

    {/* WiFi icon */}
    <svg
      height={`${Math.max(8, Math.round(13 * scale))}`}
      viewBox="0 1 13 8"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity: 0.9 }}
    >
      <path
        d="M2.2 3.1 C4.2 1.3 7.8 1.3 9.7 3.1"
        fill="none"
        stroke="white"
        strokeWidth="1.3"
        strokeLinecap="square"
      />
      <path
        d="M3.9 5 C4.8 4.1 7.2 4.1 8.2 5"
        fill="none"
        stroke="white"
        strokeWidth="1.3"
        strokeLinecap="square"
      />
      <circle cx="6" cy="7" r="0.9" fill="white" />
    </svg>

    {/* Battery icon */}
    <svg
      height={`${Math.max(8, Math.round(12 * scale))}`}
      viewBox="0 0 16 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity: 0.9 }}
    >
      <rect
        x="0.5"
        y="1"
        width="11"
        height="6"
        rx="1"
        stroke="white"
        fill="none"
      />
      <rect x="1.5" y="2" width="8" height="4" fill="white" />
      <rect x="12.2" y="3" width="1.3" height="2" rx="0.5" fill="white" />
    </svg>
  </div>
</header>

        )}
        <div className="viewport" style={viewportStyle}>
          {children}
        </div>
        
        {/* iPhone Bottom Bar / Home Indicator */}
        {device === 'iphone16' && (() => {
          // Base design dimensions from the artboard
          const baseWidth = 136
          const baseHeight = 6.5
          const baseBottom = 19
          const barWidth = Math.max(40, Math.round(baseWidth * scale))
          const barHeight = Math.max(3, Math.round(baseHeight * scale))
          const barBottom = Math.round(baseBottom * scale)
          return (
            <div 
              className="barre-apple"
              style={{
                position: 'absolute',
                width: `${barWidth}px`,
                height: `${barHeight}px`,
                left: '50%',
                marginLeft: `-${Math.round(barWidth / 2)}px`,
                bottom: `${barBottom}px`,
                background: 'rgb(65, 65, 70)',
                borderRadius: '1000px',
                zIndex: 10
              }}
            />
          )
        })()}
      </div>
    </div>
  )
}

export default DeviceFrame


