import React, { useEffect, useState } from 'react'

/**
 * Component for testing React errors in development mode
 * This component listens for custom events and triggers React errors
 */
const ErrorTestTrigger: React.FC = () => {
  const [shouldError, setShouldError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Listen for React error trigger events
    const handleReactErrorTrigger = (event: Event) => {
      const customEvent = event as CustomEvent
      setShouldError(true)
      setErrorMessage(customEvent.detail?.message || 'Test React Error')
    }

    // Listen for state error trigger events
    const handleStateErrorTrigger = (event: Event) => {
      // Simulate a state-related error by trying to update state incorrectly
      const customEvent = event as CustomEvent
      const message = customEvent.detail?.message || 'Test State Error'
      throw new Error(`React State Error: ${message}`)
    }

    window.addEventListener('trigger-react-error', handleReactErrorTrigger)
    window.addEventListener('trigger-state-error', handleStateErrorTrigger)

    return () => {
      window.removeEventListener('trigger-react-error', handleReactErrorTrigger)
      window.removeEventListener('trigger-state-error', handleStateErrorTrigger)
    }
  }, [])

  // Reset error state after a delay
  useEffect(() => {
    if (shouldError) {
      const timeout = setTimeout(() => {
        setShouldError(false)
        setErrorMessage('')
      }, 5000)

      return () => clearTimeout(timeout)
    }
    return undefined
  }, [shouldError])

  // This will trigger a React error that will be caught by ErrorBoundary
  if (shouldError) {
    throw new Error(errorMessage)
  }

  // Component doesn't render anything visible in production
  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  return null
}

export default ErrorTestTrigger
