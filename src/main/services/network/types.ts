/**
 * Network primitives for the probes, the classifier and their consumers (System Doctor).
 * `NETWORK_ERROR_CODES` is the classifier's code table and the superset the log-scan rules
 * (`diagnostics/scan/rules/network.ts`) draw from; those rules only anchor on codes seen in
 * real logs, so they may lag this table but must never contradict it.
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
  reset: ['ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_ABORTED', 'ECONNRESET', 'ECONNABORTED'],
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

export type NetworkLayerResult<T = undefined> =
  | { readonly status: 'ok'; readonly durationMs: number; readonly data: T }
  | {
      readonly status: 'failed'
      readonly durationMs: number
      readonly kind: NetworkFailureKind
      /** Raw code or HTTP status text, safe to show. */
      readonly code?: string
      /** What the layer observed before rejecting, e.g. the untrusted certificate. */
      readonly data?: T
    }
  | {
      readonly status: 'skipped'
      readonly durationMs: number
      readonly skippedBecause: 'proxy_in_use' | 'dns_failed' | 'not_https'
    }

export interface ProxyInUse {
  /** What Chromium will actually use for this URL: `DIRECT` or `PROXY host:port`. */
  readonly effective: string
  readonly configuredMode: 'none' | 'custom' | 'system'
  /** Configuration that silently does something other than what the user set. */
  readonly mismatch?: 'custom_without_url' | 'system_read_failed' | 'apply_failed'
}

export const NETWORK_ENDPOINT_IDS = ['update', 'registry', 'cloud', 'diagnostics'] as const
export type NetworkEndpointId = (typeof NETWORK_ENDPOINT_IDS)[number]

/** Built-in ids plus ad-hoc targets (a provider's API host, a user-supplied URL). */
export type NetworkEndpointRef = NetworkEndpointId | `provider:${string}` | 'custom'

export interface NetworkEndpoint {
  readonly id: NetworkEndpointRef
  readonly url: string
  readonly method?: 'HEAD' | 'GET'
}

export interface TlsPeerInfo {
  readonly issuer: string
  readonly validTo: string
}

export interface EndpointDiagnosis {
  readonly endpointId: NetworkEndpointRef
  /** Hostname only; `local_only` when it leaves the machine. */
  readonly host: string
  readonly dns: NetworkLayerResult<{ readonly addresses: readonly string[] }>
  readonly tls: NetworkLayerResult<TlsPeerInfo>
  readonly proxy: ProxyInUse
  readonly http: NetworkLayerResult<{ readonly status: number }>
  /** `reachable_untrusted_tls`: HTTP got through but a direct handshake rejected the certificate. */
  readonly verdict: 'reachable' | 'reachable_untrusted_tls' | 'unreachable'
}
