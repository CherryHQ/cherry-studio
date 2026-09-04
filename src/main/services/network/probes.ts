import { lookup } from 'node:dns/promises'
import { connect as tlsConnect } from 'node:tls'

import { NETWORK_ERROR_CODES, type NetworkFailureKind, type NetworkLayerResult } from '@shared/types/network'
import { net } from 'electron'

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
  if (nodeCode === 'ABORT_ERR' || /aborted/i.test(message)) return { kind: 'timeout', code: nodeCode ?? 'ABORTED' }
  return { kind: 'unknown', code: nodeCode ?? chromiumCode }
}

function failed<T>(started: number, error: unknown, httpStatus?: number): NetworkLayerResult<T> {
  return { status: 'failed', durationMs: performance.now() - started, ...classifyNetworkError(error, httpStatus) }
}

export async function resolveHost(
  host: string,
  signal: AbortSignal
): Promise<NetworkLayerResult<{ readonly addresses: readonly string[] }>> {
  const started = performance.now()
  try {
    // dns.lookup has no cancellation; the race keeps the caller's timeout authoritative.
    const records = await Promise.race([lookup(host, { all: true }), abortedPromise<never>(signal)])
    return { status: 'ok', durationMs: performance.now() - started, data: { addresses: records.map((r) => r.address) } }
  } catch (error) {
    return failed(started, error)
  }
}

/** Opens a TLS connection, reads the peer certificate and closes; never sends application data. */
export function tlsHandshake(
  host: string,
  port: number,
  signal: AbortSignal
): Promise<NetworkLayerResult<{ readonly issuer: string; readonly validTo: string }>> {
  const started = performance.now()
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, servername: host })
    const finish = (result: NetworkLayerResult<{ readonly issuer: string; readonly validTo: string }>) => {
      signal.removeEventListener('abort', onAbort)
      socket.destroy()
      resolve(result)
    }
    const onAbort = () => finish(failed(started, new Error('aborted')))
    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      const issuer = [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(' / ') || 'unknown'
      finish({ status: 'ok', durationMs: performance.now() - started, data: { issuer, validTo: cert.valid_to ?? '' } })
    })
    socket.once('error', (error) => finish(failed(started, error)))
  })
}

/** Goes through Electron's network stack, i.e. the same proxy and certificate handling as real traffic. */
export async function httpReach(
  url: string,
  init: { readonly method?: 'HEAD' | 'GET'; readonly signal: AbortSignal; readonly fetchImpl?: typeof fetch }
): Promise<NetworkLayerResult<{ readonly status: number }>> {
  const started = performance.now()
  // Production goes through Electron's stack; tests inject Node's fetch to hit a real loopback server.
  const doFetch = init.fetchImpl ?? net.fetch
  try {
    const response = await doFetch(url, { method: init.method ?? 'HEAD', signal: init.signal, cache: 'no-store' })
    const durationMs = performance.now() - started
    // Any HTTP status proves the server was reached; 407 and 5xx are still reported as failures.
    if (response.status === 407 || response.status >= 500) return failed(started, undefined, response.status)
    return { status: 'ok', durationMs, data: { status: response.status } }
  } catch (error) {
    return failed(started, error)
  }
}

function abortedPromise<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'))
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}
