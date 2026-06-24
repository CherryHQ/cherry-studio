import { application } from '@application'
import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('RegionService')

const CACHE_KEY = 'region.egressCountry'
// Backstop for egress changes the app cannot observe via events — e.g. a
// system-level VPN toggle that keeps the primary interface "online". Proxy
// changes made through the app invalidate sooner via the appliedProxyKey guard.
const CACHE_TTL = 10 * 60 * 1000
const REQUEST_TIMEOUT = 5000
const DEFAULT_COUNTRY = 'CN'

type CachedEgressRegion = {
  country: string
  /** ProxyManager's applied-config key in effect when this country was detected. */
  proxyKey: string | null
}

/**
 * Detects the user's egress country (and the "is in China" shorthand) by
 * geolocating the request's public IP, then caches the result.
 *
 * The detected country reflects the *egress* IP, which depends on the active
 * proxy — so the cache is keyed on ProxyManager's applied-config key and
 * invalidates the moment the app's proxy changes, with a TTL backstop for
 * egress changes the app cannot observe. Single-flight dedups concurrent
 * detections, including those arriving via the App_GetIpCountry IPC.
 */
class RegionService {
  private inflight: Promise<string> | null = null

  /** Egress country code (e.g. 'CN', 'US'); defaults to 'CN' on any failure. */
  async getCountry(): Promise<string> {
    const proxyKey = application.get('ProxyManager').appliedProxyKey
    const cached = application.get('CacheService').get<CachedEgressRegion>(CACHE_KEY)
    if (cached && cached.proxyKey === proxyKey) {
      return cached.country
    }

    // Dedup concurrent detections — callers share one in-flight request.
    this.inflight ??= this.detectAndCache(proxyKey).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /** True when the egress country resolves to China. */
  async isInChina(): Promise<boolean> {
    const country = await this.getCountry()
    return country.toLowerCase() === 'cn'
  }

  private async detectAndCache(proxyKey: string | null): Promise<string> {
    const country = await this.fetchCountry()
    application.get('CacheService').set<CachedEgressRegion>(CACHE_KEY, { country, proxyKey }, CACHE_TTL)
    return country
  }

  private async fetchCountry(): Promise<string> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

      const response = await net.fetch('https://api.ipinfo.io/lite/me?token=5aa4105b40adbc', {
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      const data = await response.json()
      const country = data.country_code || DEFAULT_COUNTRY
      logger.info(`Detected user IP address country: ${country}`)
      return country
    } catch (error) {
      logger.error('Failed to get IP address information:', error as Error)
      return DEFAULT_COUNTRY
    }
  }
}

export const regionService = new RegionService()
