import { session } from 'electron'

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ProviderTlsExceptions')

/** Chromium default verification result (do not override). */
export const CERT_VERIFY_USE_CHROMIUM = -3
/** Accept the certificate (skips Chromium's failure for this host). */
export const CERT_VERIFY_ACCEPT = 0

type ProviderTlsSource = Pick<Provider, 'settings' | 'endpointConfigs'>

/**
 * Parse the hostname of a provider API base URL.
 *
 * Only `https:` hosts need a TLS exception. Bare hosts (no scheme) are treated as
 * https, matching how connection settings store/preview custom API hosts.
 */
export function hostnameFromApiBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:') return null
    return url.hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Hostnames whose TLS certificates may be accepted when the matching provider
 * has `settings.allowSelfSignedTls === true`.
 */
export function collectAllowSelfSignedTlsHostnames(providers: readonly ProviderTlsSource[]): Set<string> {
  const hosts = new Set<string>()
  for (const provider of providers) {
    if (provider.settings?.allowSelfSignedTls !== true) continue
    for (const config of Object.values(provider.endpointConfigs ?? {})) {
      const hostname = hostnameFromApiBaseUrl(config?.baseUrl ?? '')
      if (hostname) hosts.add(hostname)
    }
  }
  return hosts
}

/** Resolve Electron `setCertificateVerifyProc` callback codes for one hostname. */
export function resolveCertificateVerifyResult(
  hostname: string,
  allowedHostnames: ReadonlySet<string>
): typeof CERT_VERIFY_ACCEPT | typeof CERT_VERIFY_USE_CHROMIUM {
  return allowedHostnames.has(hostname.toLowerCase()) ? CERT_VERIFY_ACCEPT : CERT_VERIFY_USE_CHROMIUM
}

function loadAllowedHostnames(): Set<string> {
  try {
    return collectAllowSelfSignedTlsHostnames(providerService.list({}))
  } catch (error) {
    // Boot may install the proc before DbService is queryable; fail closed.
    logger.warn('Failed to load provider TLS exception hostnames; verifying certificates', error as Error)
    return new Set()
  }
}

/**
 * Install a default-session certificate verify proc that accepts TLS errors only
 * for hostnames belonging to providers with `allowSelfSignedTls` enabled.
 *
 * AI provider HTTP uses Electron `net.fetch` on `session.defaultSession`, so this
 * is the upstream choke point for custom LLM endpoints (WebDAV's Node
 * `rejectUnauthorized: false` agent does not apply here). Returns a disposer that
 * restores Chromium's default verify proc.
 */
export function installProviderCertificateVerifyProc(): () => void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const allowed = loadAllowedHostnames()
    callback(resolveCertificateVerifyResult(request.hostname, allowed))
  })

  return () => session.defaultSession.setCertificateVerifyProc(null)
}
