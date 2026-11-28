/**
 * Classifies a failed network request by kind. `NETWORK_ERROR_CODES` is the classifier's code table
 * and the superset the log-scan rules (`diagnostics/scan/rules/network.ts`) draw from; those rules
 * only anchor on codes seen in real logs, so they may lag this table but must never contradict it.
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

const CODE_TO_KIND: ReadonlyMap<string, NetworkFailureKind> = new Map(
  (Object.entries(NETWORK_ERROR_CODES) as Array<[NetworkFailureKind, readonly string[]]>).flatMap(([kind, codes]) =>
    codes.map((code) => [code, kind] as const)
  )
)

/**
 * Maps a thrown error and/or an HTTP status to a failure kind. Reads Chromium `net::ERR_*`
 * messages, Node `code`s, and walks `cause` because undici wraps transport errors in
 * `TypeError: fetch failed` with the errno one level down.
 */
export function classifyNetworkError(
  error: unknown,
  httpStatus?: number
): { readonly kind: NetworkFailureKind; readonly code?: string } {
  if (httpStatus !== undefined) {
    if (httpStatus === 407) return { kind: 'proxy_auth', code: 'HTTP 407' }
    if (httpStatus >= 500) return { kind: 'http_server', code: `HTTP ${httpStatus}` }
    if (httpStatus >= 400) return { kind: 'http_client', code: `HTTP ${httpStatus}` }
  }
  const chain: unknown[] = []
  for (let current = error; current != null && chain.length < 5; current = (current as { cause?: unknown }).cause) {
    chain.push(current)
  }
  const nodeCode = chain
    .map((e) => (e as { code?: unknown } | null)?.code)
    .find((code): code is string => typeof code === 'string')
  const message = chain.map((e) => (e instanceof Error ? e.message : String(e))).join(' ')
  const chromiumCode = /(ERR_[A-Z_]+)/.exec(message)?.[1]
  for (const code of [nodeCode, chromiumCode]) {
    if (!code) continue
    const kind = CODE_TO_KIND.get(code)
    if (kind) return { kind, code }
    // Chromium has dozens of cert codes; the table lists the common ones, the prefix catches the rest.
    if (code.startsWith('ERR_CERT_') || code.startsWith('ERR_SSL_')) return { kind: 'tls_cert', code }
  }
  // An abort is the caller's deadline (`AbortSignal.timeout`, run cancel), never the network's verdict.
  const abort = chain
    .map((e) => (e as { name?: unknown } | null)?.name)
    .find((n) => n === 'AbortError' || n === 'TimeoutError')
  if (abort) return { kind: 'timeout', code: nodeCode ?? abort }
  return { kind: 'unknown', code: nodeCode ?? chromiumCode }
}
