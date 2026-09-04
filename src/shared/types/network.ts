/**
 * Network primitives shared by main (probes, classification) and renderer (rendering,
 * error explanation). `NETWORK_ERROR_CODES` is the classifier's code table and the superset
 * the log-scan rules (`diagnostics/scan/rules/network.ts`) draw from; those rules only anchor
 * on codes seen in real logs, so they may lag this table but must never contradict it.
 */

export type NetworkFailureKind =
  | 'offline'
  | 'dns'
  | 'refused'
  | 'reset'
  | 'timeout'
  | 'tls_cert'
  | 'proxy_unreachable'
  | 'proxy_auth'
  | 'http_client'
  | 'http_server'
  | 'unknown'

/** Concrete Chromium (`ERR_*`) and Node (`E*`, OpenSSL) codes per failure kind. */
export const NETWORK_ERROR_CODES: Readonly<Record<NetworkFailureKind, readonly string[]>> = {
  offline: ['ERR_INTERNET_DISCONNECTED', 'ENETUNREACH'],
  dns: ['ERR_NAME_NOT_RESOLVED', 'ENOTFOUND', 'EAI_AGAIN'],
  refused: ['ERR_CONNECTION_REFUSED', 'ECONNREFUSED'],
  reset: ['ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ECONNRESET'],
  timeout: ['ERR_TIMED_OUT', 'ERR_CONNECTION_TIMED_OUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'],
  tls_cert: [
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_CERT_COMMON_NAME_INVALID',
    'ERR_CERT_DATE_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'
  ],
  proxy_unreachable: ['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED'],
  proxy_auth: ['ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_PROXY_AUTH_REQUESTED'],
  http_client: [],
  http_server: [],
  unknown: []
}

export interface NetworkLayerResult<T = undefined> {
  readonly status: 'ok' | 'failed' | 'skipped'
  readonly durationMs: number
  /** Set when `failed`. */
  readonly kind?: NetworkFailureKind
  /** Raw code or HTTP status text, safe to show. */
  readonly code?: string
  readonly skippedBecause?: 'proxy_in_use' | 'dns_failed' | 'not_https'
  readonly data?: T
}

export interface ProxyInUse {
  /** What Chromium will actually use for this URL: `DIRECT` or `PROXY host:port`. */
  readonly effective: string
  readonly configuredMode: 'none' | 'custom' | 'system'
  /** Configuration that silently does something other than what the user set. */
  readonly mismatch?: 'custom_without_url' | 'system_proxy_ignored' | 'system_read_failed'
}

export interface EndpointDiagnosis {
  /** `update` | `registry` | `cloud` | `diagnostics` | `provider:<id>` | `custom` */
  readonly endpointId: string
  /** Hostname only; `local_only` when it leaves the machine. */
  readonly host: string
  readonly dns: NetworkLayerResult<{ readonly addresses: readonly string[] }>
  readonly tls: NetworkLayerResult<{ readonly issuer: string; readonly validTo: string }>
  readonly proxy: ProxyInUse
  readonly http: NetworkLayerResult<{ readonly status: number }>
  readonly verdict: 'reachable' | 'reachable_via_proxy_only' | 'unreachable'
}
