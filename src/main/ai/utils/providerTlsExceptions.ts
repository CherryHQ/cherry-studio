import type { FetchFunction } from '@ai-sdk/provider-utils'
import { type Session, session } from 'electron'

import { application } from '@application'
import type { Provider } from '@shared/data/types/provider'

import { createProviderFetch, customFetch, installProviderUserAgentInterceptor } from './customFetch'

/** Chromium default verification result (do not override). */
export const CERT_VERIFY_USE_CHROMIUM = -3
/** Accept the certificate (skips Chromium's failure for this host). */
export const CERT_VERIFY_ACCEPT = 0
/** Chromium `net::ERR_CERT_AUTHORITY_INVALID` (self-signed or private CA). */
export const CERT_AUTHORITY_INVALID = -202

type ProviderTlsSource = Pick<Provider, 'isEnabled' | 'settings' | 'endpointConfigs'>

/** In-memory partition prefix. `persist:` would write the exception to disk. */
const PROVIDER_TLS_PARTITION_PREFIX = 'cherry-provider-tls:'

/** Sessions that already have the User-Agent interceptor. The verify proc is refreshed per call. */
const hookedTlsSessions = new WeakSet<Session>()
/** In-memory TLS partitions, so opt-out and deletion can drop the exception. */
const tlsSessionsByProviderId = new Map<string, Session>()

export interface CertificateVerifyFailure {
  errorCode?: number
  verificationResult?: string
}

function isUntrustedIssuerFailure(failure: CertificateVerifyFailure | undefined): boolean {
  if (!failure) return false
  if (failure.errorCode === CERT_AUTHORITY_INVALID) return true
  return failure.verificationResult?.includes('ERR_CERT_AUTHORITY_INVALID') === true
}

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
 * Hostnames whose TLS certificates may be accepted when the matching enabled
 * provider has `settings.allowSelfSignedTls === true`.
 */
export function collectAllowSelfSignedTlsHostnames(providers: readonly ProviderTlsSource[]): Set<string> {
  const hosts = new Set<string>()
  for (const provider of providers) {
    if (!provider.isEnabled || provider.settings?.allowSelfSignedTls !== true) continue
    for (const config of Object.values(provider.endpointConfigs ?? {})) {
      const urls = [config?.baseUrl, ...Object.values(config?.modelsApiUrls ?? {})]
      for (const url of urls) {
        const hostname = hostnameFromApiBaseUrl(url ?? '')
        if (hostname) hosts.add(hostname)
      }
    }
  }
  return hosts
}

/**
 * Resolve Electron `setCertificateVerifyProc` callback codes for one request.
 *
 * `CERT_VERIFY_ACCEPT` (0) trusts the certificate outright, including expired
 * or name-mismatched leaves. The opt-in only overrides an untrusted issuer.
 */
export function resolveCertificateVerifyResult(
  hostname: string,
  allowedHostnames: ReadonlySet<string>,
  failure?: CertificateVerifyFailure
): typeof CERT_VERIFY_ACCEPT | typeof CERT_VERIFY_USE_CHROMIUM {
  if (!allowedHostnames.has(hostname.toLowerCase())) return CERT_VERIFY_USE_CHROMIUM
  return isUntrustedIssuerFailure(failure) ? CERT_VERIFY_ACCEPT : CERT_VERIFY_USE_CHROMIUM
}

/**
 * Drop a provider's TLS partition: Chromium verification, open connections,
 * and the proxy registration. Idempotent when the provider never opted in.
 */
export function releaseProviderTlsSession(providerId: string): void {
  const scoped = tlsSessionsByProviderId.get(providerId)
  if (!scoped) return
  tlsSessionsByProviderId.delete(providerId)
  hookedTlsSessions.delete(scoped)
  scoped.setCertificateVerifyProc(null)
  void scoped.closeAllConnections()
  application.get('ProxyService').unregisterProxySession(scoped)
}

/** Release when a saved provider is disabled or no longer opts in. */
export function releaseProviderTlsSessionIfInactive(provider: {
  id: string
  isEnabled: boolean
  settings?: { allowSelfSignedTls?: boolean | null }
}): void {
  if (provider.isEnabled && provider.settings?.allowSelfSignedTls === true) return
  releaseProviderTlsSession(provider.id)
}

/**
 * Keep the default session on Chromium verification.
 *
 * A hostname allowlist here would accept every caller to that host, including
 * disabled providers and unrelated requests. Opted-in calls use
 * {@link createProviderScopedFetch} instead. Returns a disposer that restores
 * Chromium's default verify proc.
 */
export function installProviderCertificateVerifyProc(): () => void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    void request
    callback(CERT_VERIFY_USE_CHROMIUM)
  })

  return () => session.defaultSession.setCertificateVerifyProc(null)
}

/**
 * Fetch for one provider's opted-in TLS exception.
 *
 * Enabled providers with `allowSelfSignedTls` use a reused in-memory session
 * whose verify proc accepts only that provider's HTTPS hosts. The session is
 * registered with ProxyService and sends through {@link createProviderFetch}.
 * Every other provider uses {@link customFetch} (`net.fetch` on the default session).
 * The default session never receives this verify proc.
 */
export function createProviderScopedFetch(provider: ProviderTlsSource & Pick<Provider, 'id'>): FetchFunction {
  const allowed = collectAllowSelfSignedTlsHostnames([provider])
  if (allowed.size === 0) return customFetch

  const scoped = session.fromPartition(`${PROVIDER_TLS_PARTITION_PREFIX}${provider.id}`)
  tlsSessionsByProviderId.set(provider.id, scoped)
  scoped.setCertificateVerifyProc((request, callback) => {
    callback(
      resolveCertificateVerifyResult(request.hostname, allowed, {
        errorCode: request.errorCode,
        verificationResult: request.verificationResult
      })
    )
  })
  if (!hookedTlsSessions.has(scoped)) {
    hookedTlsSessions.add(scoped)
    installProviderUserAgentInterceptor(scoped)
  }

  const sessionFetch = createProviderFetch((input, init) => scoped.fetch(input, init))
  let proxyReady: Promise<void> | undefined
  let proxySettled = false
  return (input, init) => {
    if (proxySettled) return sessionFetch(input, init)
    proxyReady ??= application
      .get('ProxyService')
      .registerProxySession(scoped)
      .then(() => {
        proxySettled = true
      })
      .catch((error) => {
        proxyReady = undefined
        throw error
      })
    return proxyReady.then(() => sessionFetch(input, init))
  }
}
