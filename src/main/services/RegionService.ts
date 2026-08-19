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
  private inflight: Promise<string> | null = null

  /** Egress country code (e.g. 'CN', 'US'); defaults to 'CN' on any failure. */
  async getCountry(): Promise<string> {
    const proxyKey = application.get('ProxyService').appliedProxyKey
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
    try {
      const country = await this.fetchCountry()
      application.get('CacheService').set<CachedEgressRegion>(CACHE_KEY, { country, proxyKey }, CACHE_TTL)
      return country
    } catch (error) {
      logger.error('Failed to get IP address information:', error as Error)
      return DEFAULT_COUNTRY
    }
  }

  private async fetchCountry(): Promise<string> {
    return new Promise((resolve, reject) => {
      // net.fetch converts response headers through Web Headers; a proxy's Unicode
      // diagnostic header can throw outside the returned promise.
      const request = net.request('https://api.ipinfo.io/lite/me?token=5aa4105b40adbc')
      let settled = false

      const finish = (error: Error | null, country?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)

        if (error) {
          reject(error)
        } else {
          resolve(country!)
        }
      }

      const timeoutId = setTimeout(() => {
        request.abort()
        finish(new Error('IP info request timed out'))
      }, REQUEST_TIMEOUT)

      request.on('response', (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.on('data', () => {})
          finish(new Error(`IP info request failed with HTTP ${response.statusCode}`))
          return
        }

        const chunks: Buffer[] = []
        response.on('error', (error) => finish(error))
        response.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const country = data.country_code
            if (!country) {
              throw new Error('IP info response missing country_code')
            }

            logger.info(`Detected user IP address country: ${country}`)
            finish(null, country)
          } catch (error) {
            finish(error as Error)
          }
        })
        response.on('data', (chunk) => chunks.push(chunk))
      })
      request.on('error', (error) => finish(error))
      request.end()
    })
  }
}

export const regionService = new RegionService()
