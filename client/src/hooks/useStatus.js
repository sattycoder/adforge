import { useState, useCallback, useRef } from 'react'

export const useStatus = () => {
  const [status, setStatus] = useState('')
  const timeoutRef = useRef(null)

  const setStatusWithTimeout = useCallback((message, timeout = 5000) => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set the new status message
    setStatus(message)

    // If message is not empty, set timeout to clear it
    if (message && message.trim() !== '') {
      timeoutRef.current = setTimeout(() => {
        setStatus('')
        timeoutRef.current = null
      }, timeout)
    }
  }, [])

  // Cleanup timeout on unmount
  const clearStatus = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setStatus('')
  }, [])

  return {
    status,
    setStatus: setStatusWithTimeout,
    clearStatus
  }
}
