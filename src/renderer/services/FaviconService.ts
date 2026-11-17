import { loggerService } from '@logger'

const logger = loggerService.withContext('FaviconService')

const FAILED_FAVICON_CACHE_PREFIX = 'failed_favicon_'
const FAILED_FAVICON_CACHE_DURATION = 24 * 60 * 60 * 1000
const RESOLVED_FAVICON_CACHE_PREFIX = 'favicon_src_'
const RESOLVED_FAVICON_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000
const FAVICON_PROBE_TIMEOUT_MS = 2000

const faviconUrlsFor = (hostname: string): string[] => [
  `https://icon.horse/icon/${hostname}`,
  `https://favicon.splitbee.io/?url=${hostname}`,
  `https://favicon.im/${hostname}`,
  `https://${hostname}/favicon.ico`
]

class FaviconService {
  private resolvedSrcByHostname = new Map<string, string>()
  private inflightByHostname = new Map<string, Promise<string>>()

  resolve(hostname: string): Promise<string> {
    const cached = this.readResolvedSrc(hostname)
    if (cached) return Promise.resolve(cached)

    const inflight = this.inflightByHostname.get(hostname)
    if (inflight) return inflight

    const request = this.probeFaviconSrc(hostname)
      .then((src) => {
        this.writeResolvedSrc(hostname, src)
        return src
      })
      .finally(() => {
        this.inflightByHostname.delete(hostname)
      })

    this.inflightByHostname.set(hostname, request)
    return request
  }

  invalidate(hostname: string, src: string): void {
    this.markUrlAsFailed(src)
    this.resolvedSrcByHostname.delete(hostname)

    try {
      localStorage.removeItem(`${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`)
    } catch {
      // Storage can be unavailable; the in-memory entry is still invalidated.
    }
  }

  private isUrlFailedRecently(url: string): boolean {
    const cacheKey = `${FAILED_FAVICON_CACHE_PREFIX}${url}`

    try {
      const cachedTimestamp = localStorage.getItem(cacheKey)
      if (!cachedTimestamp) return false
      if (Date.now() - parseInt(cachedTimestamp, 10) < FAILED_FAVICON_CACHE_DURATION) return true

      localStorage.removeItem(cacheKey)
      return false
    } catch {
      return false
    }
  }

  private markUrlAsFailed(url: string): void {
    try {
      localStorage.setItem(`${FAILED_FAVICON_CACHE_PREFIX}${url}`, Date.now().toString())
    } catch {
      // Storage can be unavailable in privacy mode.
    }
  }

  private readResolvedSrc(hostname: string): string | undefined {
    const inMemory = this.resolvedSrcByHostname.get(hostname)
    if (inMemory) return inMemory

    const cacheKey = `${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`

    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) return undefined

      const entry = JSON.parse(raw) as { src?: string; at?: number }
      if (!entry.src || !entry.at || Date.now() - entry.at > RESOLVED_FAVICON_CACHE_DURATION) {
        localStorage.removeItem(cacheKey)
        return undefined
      }

      this.resolvedSrcByHostname.set(hostname, entry.src)
      return entry.src
    } catch {
      return undefined
    }
  }

  private writeResolvedSrc(hostname: string, src: string): void {
    this.resolvedSrcByHostname.set(hostname, src)

    try {
      localStorage.setItem(`${RESOLVED_FAVICON_CACHE_PREFIX}${hostname}`, JSON.stringify({ src, at: Date.now() }))
    } catch {
      // The in-memory cache remains available.
    }
  }

  private probeFaviconSrc(hostname: string): Promise<string> {
    const urls = faviconUrlsFor(hostname)
    const candidates = urls.filter((url) => !this.isUrlFailedRecently(url))
    if (candidates.length === 0) return Promise.resolve(urls[0])

    const controller = new AbortController()
    const probes = candidates.map((url) =>
      fetch(url, { method: 'HEAD', signal: controller.signal, credentials: 'omit' }).then((response) => {
        if (response.ok) return url

        if (response.status >= 400) this.markUrlAsFailed(url)
        throw new Error(`Failed to fetch ${url}`)
      })
    )

    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        controller.abort()
        resolve(urls[0])
      }, FAVICON_PROBE_TIMEOUT_MS)

      Promise.any(probes)
        .then((url) => resolve(url))
        .catch(() => {
          // HEAD can fail while the image GET succeeds; image errors invalidate this optimistic result.
          logger.debug('All favicon sources failed; falling back to the first candidate', { hostname })
          resolve(urls[0])
        })
        .finally(() => {
          clearTimeout(timer)
          controller.abort()
        })
    })
  }
}

export const faviconService = new FaviconService()
