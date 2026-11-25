import { net } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('RegionService')

const CACHE_KEY = 'region.egressCountry'
// Backstop for egress changes the app cannot observe via events — e.g. a
// system-level VPN toggle that keeps the primary interface "online". Proxy
// changes made through the app invalidate sooner via the appliedProxyKey guard.
const CACHE_TTL = 10 * 60 * 1000
const REQUEST_TIMEOUT = 5000
const DEFAULT_COUNTRY = 'CN'

type CountrySource = { url: string; readCountry: (data: any) => string | undefined }

// Tried in order: InternetData is asked only when ipinfo fails, before getCountry() falls back to DEFAULT_COUNTRY.
const COUNTRY_SOURCES: CountrySource[] = [
  { url: 'https://api.ipinfo.io/lite/me?token=5aa4105b40adbc', readCountry: (data) => data.country_code },
  { url: 'https://api.internetdata.io/myip', readCountry: (data) => data.location?.country }
]

type CachedEgressRegion = {
  country: string
  /** ProxyService's applied-config key in effect when this country was detected. */
  proxyKey: string | null
}

/**
 * Detects the user's egress country (and the "is in China" shorthand) by
 * geolocating the request's public IP, then caches the result.
 *
 * The detected country reflects the *egress* IP, which depends on the active
 * proxy — so the cache is keyed on ProxyService's applied-config key and
 * invalidates the moment the app's proxy changes, with a TTL backstop for
 * egress changes the app cannot observe. Single-flight dedups concurrent
 * detections, including those arriving via the system.get_ip_country IPC.
 */
class RegionService {
  private inflight = new Map<string | null, { promise: Promise<string> }>()

  /** Egress country code (e.g. 'CN', 'US'); defaults to 'CN' on any failure, but an abort still throws. */
  async getCountry(signal?: AbortSignal): Promise<string> {
    try {
      return await this.getDetectedCountry(signal)
    } catch {
      signal?.throwIfAborted()
      return DEFAULT_COUNTRY
    }
  }

  /** True only when the egress country is successfully detected as China. */
  async detectIsInChina(signal?: AbortSignal): Promise<boolean> {
    const country = await this.getDetectedCountry(signal)
    return country.toLowerCase() === 'cn'
  }

  async isInChina(signal?: AbortSignal): Promise<boolean> {
    try {
      return await this.detectIsInChina(signal)
    } catch {
      signal?.throwIfAborted()
      return false
    }
  }

  /** The cached country for the proxy in effect, or null; never detects. */
  getCachedCountry(): string | null {
    const proxyKey = application.get('ProxyService').appliedProxyKey
    const cached = application.get('CacheService').get<CachedEgressRegion>(CACHE_KEY)
    return cached && cached.proxyKey === proxyKey ? cached.country : null
  }

  private async getDetectedCountry(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const cached = this.getCachedCountry()
    if (cached) return cached

    const proxyKey = application.get('ProxyService').appliedProxyKey
    // A caller with its own deadline neither joins nor becomes the shared request: aborting it
    // must not cancel detection for everyone else.
    if (signal) return this.detectAndCache(proxyKey, signal)

    // Dedup concurrent detections for the active proxy — callers share one in-flight request.
    const current = this.inflight.get(proxyKey)
    if (current) {
      return current.promise
    }

    const inflight = {
      promise: this.detectAndCache(proxyKey)
    }
    inflight.promise = inflight.promise.finally(() => {
      if (this.inflight.get(proxyKey) === inflight) {
        this.inflight.delete(proxyKey)
      }
    })
    this.inflight.set(proxyKey, inflight)
    return inflight.promise
  }

  private async detectAndCache(proxyKey: string | null, signal?: AbortSignal): Promise<string> {
    try {
      const country = await this.fetchCountry(signal)
      if (application.get('ProxyService').appliedProxyKey === proxyKey) {
        application.get('CacheService').set<CachedEgressRegion>(CACHE_KEY, { country, proxyKey }, CACHE_TTL)
      }
      return country
    } catch (error) {
      signal?.throwIfAborted()
      logger.error('Failed to get IP address information:', error as Error)
      throw error
    }
  }

  private async fetchCountry(signal?: AbortSignal): Promise<string> {
    let firstError: unknown
    for (const source of COUNTRY_SOURCES) {
      try {
        return await this.fetchCountryFrom(source, signal)
      } catch (error) {
        signal?.throwIfAborted()
        firstError ??= error
        logger.warn(`IP country lookup via ${new URL(source.url).hostname} failed:`, error as Error)
      }
    }
    throw firstError
  }

  private async fetchCountryFrom(source: CountrySource, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const response = await net.fetch(source.url, {
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      })

      if (!response.ok) {
        throw new Error(`IP info request failed with HTTP ${response.status}`)
      }

      const data = await response.json()
      const country = source.readCountry(data)
      if (!country) {
        throw new Error('IP info response missing country code')
      }

      logger.info(`Detected user IP address country: ${country}`)
      return country
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

export const regionService = new RegionService()
