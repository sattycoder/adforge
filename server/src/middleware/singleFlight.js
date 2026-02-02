// Track active requests by URL + device combination
const activeRequests = new Map()

export const singleFlight = () => (req, res, next) => {
  const { url, device, userEmail } = req.query
  const requestKey = userEmail 
    ? `${url}-${device}-${userEmail}`  // Include userEmail for multi-user concurrency
    : `${url}-${device}`                // Fallback for backward compatibility
  
  // Check if there's already a request for the same URL and device
  if (activeRequests.has(requestKey)) {
    console.log(`⏳ Request already in progress for ${device}, queuing...`)
    return res.status(429).json({ 
      success: false, 
      message: `Request for ${device} already in progress. Try again shortly.` 
    })
  }
  
  // Mark this request as active
  activeRequests.set(requestKey, {
    startTime: Date.now(),
    device
  })
  
  const cleanup = () => {
    activeRequests.delete(requestKey)
    console.log(`✅ Request completed for ${device}`)
  }
  
  // Clean up when response is sent
  res.on('finish', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)
  
  // Also clean up after 5 minutes to prevent memory leaks
  setTimeout(cleanup, 5 * 60 * 1000)
  
  console.log(`🔄 Starting request for ${device}`)
  next()
}



