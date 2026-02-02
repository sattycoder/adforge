import React, { useMemo, useState } from 'react'

// Expects slot = { id, position: { x, y }, size: { width, height } }
// imageNaturalSize = { width, height } of the screenshot
const AdOverlay = ({ slot, imageNaturalSize, onClick, onDrop, disabled = false }) => {
  const [isDragOver, setIsDragOver] = useState(false)

  // Compute percentages so overlay scales with image element width
  const style = useMemo(() => {
    const iw = imageNaturalSize?.width || 1
    const ih = imageNaturalSize?.height || 1

    // Use absolute positions directly (backend already accounts for scroll)
    // Convert to pixels first, then to percentages
    const leftPx = (slot.position?.x || 0)
    const topPx = (slot.position?.y || 0)
    const widthPx = (slot.size?.width || 0)
    const heightPx = (slot.size?.height || 0)

    // Convert to percentages relative to the full image
    const leftPct = (leftPx / iw) * 100
    const topPct = (topPx / ih) * 100
    const widthPct = (widthPx / iw) * 100
    const heightPct = (heightPx / ih) * 100

    return {
      position: 'absolute',
      left: `${leftPct}%`,
      top: `${topPct}%`,
      width: `${widthPct}%`,
      height: `${heightPct}%`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      pointerEvents: disabled ? 'none' : 'auto',
      border: isDragOver ? '5px dashed rgba(34,197,94,0.9)' : '4px dashed rgba(37, 99, 235, 1)', // Thicker, more prominent blue border
      background: isDragOver ? 'rgba(34,197,94,0.25)' : 'rgba(18, 69, 178, 0.56)', // More prominent blue background
      transition: 'all 0.2s ease-in-out',
    }
  }, [slot, imageNaturalSize, isDragOver])

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && onDrop) {
      onDrop(files[0], slot)
    }
  }

  return (
    <div
      role="button"
      aria-label={`Ad slot ${slot.id}`}
      style={style}
      onClick={disabled ? undefined : onClick}
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
    >
      {isDragOver && !disabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-green-500 bg-opacity-20 rounded">
          <div className="text-green-700 font-semibold text-sm">
            Drop file here
          </div>
        </div>
      )}
    </div>
  )
}

export default AdOverlay


