import { useEffect, useState } from 'react'
import styled from 'styled-components'

// FallbackFavicon component that tries multiple favicon sources
interface FallbackFaviconProps {
  hostname: string
  alt: string
}

const FallbackFavicon: React.FC<FallbackFaviconProps> = ({ hostname, alt }) => {
  type FaviconState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'loaded'; src: string }

  const [faviconState, setFaviconState] = useState<FaviconState>({ status: 'idle' })

  useEffect(() => {
    // Reset state when hostname changes
    setFaviconState({ status: 'loading' })

    // Generate all possible favicon URLs
    const faviconUrls = [
      `https://favicon.splitbee.io/?url=${hostname}`,
      `https://${hostname}/favicon.ico`,
      `https://icon.horse/icon/${hostname}`,
      `https://favicon.cccyun.cc/${hostname}`,
      `https://favicon.im/${hostname}`,
      `https://www.google.com/s2/favicons?domain=${hostname}`
    ]

    // Main controller to abort all requests when needed
    const controller = new AbortController()
    const { signal } = controller

    // Create a promise for each favicon URL
    const faviconPromises = faviconUrls.map((url) =>
      fetch(url, {
        method: 'HEAD',
        signal,
        credentials: 'omit'
      })
        .then((response) => {
          if (response.ok) {
            return url
          }
          throw new Error(`Failed to fetch ${url}`)
        })
        .catch((error) => {
          // Rethrow aborted errors but silence other failures
          if (error.name === 'AbortError') {
            throw error
          }
          console.debug(`Failed to fetch favicon from ${url}:`, error)
          return null // Return null for failed requests
        })
    )

    // Create a timeout promise
    const timeoutPromise = new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        resolve(faviconUrls[0]) // Default to first URL after timeout
      }, 2000)

      // Clear timeout if signal is aborted
      signal.addEventListener('abort', () => clearTimeout(timer))
    })

    // Use Promise.race to get the first successful result
    Promise.race([
      // Filter out failed requests (null results)
      Promise.any(faviconPromises)
        .then((result) => result || faviconUrls[0]) // Ensure we always have a string, not null
        .catch(() => faviconUrls[0]),
      timeoutPromise
    ])
      .then((url) => {
        setFaviconState({ status: 'loaded', src: url })
      })
      .catch((error) => {
        console.debug('All favicon requests failed:', error)
        setFaviconState({ status: 'loaded', src: faviconUrls[0] })
      })

    // Cleanup function
    return () => {
      controller.abort()
    }
  }, [hostname]) // Only depend on hostname

  const handleError = () => {
    setFaviconState({ status: 'failed' })
  }

  // Render based on current state
  if (faviconState.status === 'failed') {
    return <FaviconPlaceholder>{hostname.charAt(0).toUpperCase()}</FaviconPlaceholder>
  }

  if (faviconState.status === 'loaded') {
    return <Favicon src={faviconState.src} alt={alt} onError={handleError} />
  }

  return <FaviconLoading />
}

const FaviconLoading = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--color-background-mute);
`

const FaviconPlaceholder = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--color-primary-1);
  color: var(--color-primary-6);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
`
const Favicon = styled.img`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--color-background-mute);
`

export default FallbackFavicon
