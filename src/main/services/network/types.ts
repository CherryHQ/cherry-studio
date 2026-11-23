/** Network primitives for the probes and their consumers (System Doctor). */

import type { NetworkFailureKind } from '@main/utils/networkError'

export type { NetworkFailureKind }

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
