import { loggerService } from '@logger'
import { useEffect, useState } from 'react'
import styled from 'styled-components'

const logger = loggerService.withContext('FallbackFavicon')

// 记录失败的URL的缓存键前缀
const FAILED_FAVICON_CACHE_PREFIX = 'failed_favicon_'
// 失败URL的缓存时间 (24小时)
const FAILED_FAVICON_CACHE_DURATION = 24 * 60 * 60 * 1000

// 检查URL是否在失败缓存中
const isUrlFailedRecently = (url: string): boolean => {
  const cacheKey = `${FAILED_FAVICON_CACHE_PREFIX}${url}`
  const cachedTimestamp = localStorage.getItem(cacheKey)

  if (!cachedTimestamp) return false

  const timestamp = parseInt(cachedTimestamp, 10)
  const now = Date.now()

  // 如果时间戳在缓存期内，则认为URL仍处于失败状态
  if (now - timestamp < FAILED_FAVICON_CACHE_DURATION) {
    return true
  }

  // 清除过期的缓存
  localStorage.removeItem(cacheKey)
  return false
}

// 记录失败的URL到缓存
const markUrlAsFailed = (url: string): void => {
  const cacheKey = `${FAILED_FAVICON_CACHE_PREFIX}${url}`
  localStorage.setItem(cacheKey, Date.now().toString())
}

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
      `https://icon.horse/icon/${hostname}`,
      `https://favicon.splitbee.io/?url=${hostname}`,
      `https://favicon.im/${hostname}`,
      `https://${hostname}/favicon.ico`
    ]

    // 过滤掉最近已失败的URL
    const validFaviconUrls = faviconUrls.filter((url) => !isUrlFailedRecently(url))

    // 如果所有URL都被缓存为失败，使用第一个URL
    if (validFaviconUrls.length === 0) {
      setFaviconState({ status: 'loaded', src: faviconUrls[0] })
      return
    }

    // Main controller to abort all requests when needed
    const controller = new AbortController()
    const { signal } = controller

    // Create a promise for each favicon URL
    const faviconPromises = validFaviconUrls.map((url) =>
      fetch(url, {
        method: 'HEAD',
        signal,
        credentials: 'omit'
      })
        .then((response) => {
          if (response.ok) {
            return url
          }
          // 记录4xx或5xx失败
          if (response.status >= 400) {
            markUrlAsFailed(url)
          }
          throw new Error(`Failed to fetch ${url}`)
        })
        .catch((error) => {
          // Rethrow aborted errors but silence other failures
          if (error.name === 'AbortError') {
            throw error
          }
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
        logger.error('All favicon requests failed:', error)
        setFaviconState({ status: 'loaded', src: faviconUrls[0] })
      })

    // Cleanup function
    return () => {
      controller.abort()
    }
  }, [hostname]) // Only depend on hostname

  const handleError = () => {
    if (faviconState.status === 'loaded') {
      // 记录图片加载失败的URL
      markUrlAsFailed(faviconState.src)
    }
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
