import dns from 'node:dns'

import { MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import { net } from 'electron'
import * as z from 'zod'

import { MiniAppUnavailableError } from '../errors'
import { PermissionDeniedError } from '../grants'
import { installationOf } from '../install/installer'
import { networkLimiter, QuotaExceededError } from './quota'

export const MINI_APP_FETCH_MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Mirrors the browser's forbidden-header list, minus what does not apply here.
 *
 * `Host` is the one that matters most: the URL decides which machine we connect to, but
 * `Host` decides which backend a reverse proxy routes to — declare `api.mygame.com`,
 * connect there, send `Host: internal-admin`, and the hostname allowlist means nothing.
 * `Authorization` is NOT here: that is the app's own credential, not the user's.
 */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'origin',
  'referer',
  'cookie'
])

/** Not the guest's business: cookie state of the remote and hop-by-hop transport headers. */
const UNFORWARDED_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer'
])
const forwardsHeader = (name: string) => !UNFORWARDED_HEADERS.has(name) && !name.startsWith('proxy-')

export const MINI_APP_FETCH_TIMEOUT_MS = 30_000
/** Design §9 freezes the REQUEST body at 1 MB; these are the same limit either side of base64. */
export const MINI_APP_FETCH_MAX_REQUEST_BYTES = 1024 * 1024
export const MINI_APP_FETCH_MAX_REQUEST_CHARS = Math.ceil(MINI_APP_FETCH_MAX_REQUEST_BYTES / 3) * 4 + 4

const FetchParams = z.object({
  url: z.string().max(2048),
  // An enum, not a free string: `TRACE` and `CONNECT` are request-smuggling surface
  // and `net.fetch` would send them without comment.
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z
    .record(z.string().max(128), z.string().max(4096))
    .refine((h) => Object.keys(h).length <= 32, 'at most 32 headers')
    .refine(
      (h) => !Object.keys(h).some((k) => FORBIDDEN_HEADERS.has(k.toLowerCase())),
      'header is not settable by a mini app'
    )
    .default({}),
  // `z.base64()` like `file.save`, not a plain string: `Buffer.from(x, 'base64')` skips
  // invalid characters silently, so a typo becomes a DIFFERENT payload rather than an error.
  body: z.base64().max(MINI_APP_FETCH_MAX_REQUEST_CHARS).optional()
})

/**
 * One algorithm, defined once. "Hostname allowlist" has ten plausible implementations
 * and several of them are dangerous (suffix matching, parent matching).
 */
export function isAllowedUrl(url: string, hosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  // `URL` normalises an explicit `:443` to the empty string, so a declared host still
  // works when written out; any other port is refused rather than silently matched.
  if (parsed.port !== '') return false
  if (parsed.hostname.startsWith('[') || /^\d+(\.\d+)*$/.test(parsed.hostname)) return false
  return hosts.includes(parsed.hostname)
}

/**
 * The same targets `isAllowedUrl` refuses as literals, reached by NAME instead: the author
 * controls the DNS of the host they declared, so an A record pointing at `127.0.0.1`,
 * `10.x` or `169.254.169.254` would turn the main process into an SSRF proxy. Covers
 * loopback, unspecified, RFC 1918, link-local, ULA and the `::ffff:` mapped forms.
 */
export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase()
  const v4 = ipv4Octets(lower)
  if (v4) {
    const [a, b] = v4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (lower === '::' || lower === '::1') return true
  const head = Number.parseInt(lower.split(':')[0] || '0', 16)
  return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80
}

/** Dotted IPv4, `::ffff:a.b.c.d`, or its hex spelling `::ffff:hhhh:hhhh`; undefined for real IPv6. */
function ipv4Octets(lower: string): number[] | undefined {
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (hex) return [hex[1], hex[2]].flatMap((g) => [Number.parseInt(g, 16) >> 8, Number.parseInt(g, 16) & 0xff])
  const dotted = lower.startsWith('::ffff:') ? lower.slice(7) : lower
  return dotted.includes('.') ? dotted.split('.').map(Number) : undefined
}

export const networkCapability = {
  async fetch(appId: string, params: unknown) {
    const { url, method, headers, body } = FetchParams.parse(params)
    // The MANIFEST, not the grant table: hosts are the scope of `network.fetch`, not
    // grants of their own. The revocable half is the capability, checked at the bridge.
    const hosts = MiniAppManifestSchema.parse(installationOf(appId).manifestJson).network
    if (!isAllowedUrl(url, hosts)) {
      throw new PermissionDeniedError(
        appId,
        'network.fetch',
        `Mini app "${appId}" may not fetch ${url}: only https on the default port to a host the manifest declares`
      )
    }
    const requestBody = body ? Buffer.from(body, 'base64') : undefined
    // Re-checked in BYTES after decoding: the guest gate and the schema both bound the
    // base64 TEXT, and base64 is only an upper bound on what it decodes to.
    if (requestBody && requestBody.byteLength > MINI_APP_FETCH_MAX_REQUEST_BYTES) {
      throw new QuotaExceededError(`Request body exceeds ${MINI_APP_FETCH_MAX_REQUEST_BYTES} bytes`)
    }

    // Acquired LAST, right before the `try` that releases it: anything that throws between
    // `acquire` and `try` leaks a slot for good, and four leaks kill this app's networking.
    const release = networkLimiter.acquire(appId)
    const abort = new AbortController()
    // Covers the WHOLE exchange, not just the headers: a server that answers and then
    // dangles its body would otherwise hold a concurrency slot for ever.
    const timer = setTimeout(() => abort.abort(), MINI_APP_FETCH_TIMEOUT_MS)
    try {
      // Resolved here and connected by Chromium: the answer can change in between (TOCTOU,
      // accepted by the plan). Inside the try so a lookup failure reports like any DNS error.
      const addresses = await dns.promises.lookup(new URL(url).hostname, { all: true })
      if (addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new PermissionDeniedError(
          appId,
          'network.fetch',
          `Mini app "${appId}" may not fetch ${url}: the host resolves to a private address`
        )
      }
      const response = await net.fetch(url, {
        method,
        headers,
        ...(requestBody ? { body: requestBody } : {}),
        // MANDATORY: Electron sends the session's auth data when this is unset, and the
        // default session is Cherry's own (`electron.d.ts:20240`).
        credentials: 'omit',
        // Not per-hop adjudication: a redirect is refused outright, matching how the
        // installer fetches packages.
        redirect: 'error',
        signal: abort.signal
      })

      const chunks: Uint8Array[] = []
      let total = 0
      for await (const chunk of response.body ?? []) {
        total += chunk.byteLength
        if (total > MINI_APP_FETCH_MAX_BODY_BYTES) {
          // Abort, do not just throw: leaving the stream open keeps the socket and the
          // concurrency slot alive for as long as the server cares to keep sending.
          abort.abort()
          throw new QuotaExceededError(`Response exceeds ${MINI_APP_FETCH_MAX_BODY_BYTES} bytes`)
        }
        chunks.push(chunk)
      }
      return {
        status: response.status,
        headers: Object.fromEntries([...response.headers].filter(([name]) => forwardsHeader(name))),
        body: Buffer.concat(chunks).toString('base64')
      }
    } catch (error) {
      if (error instanceof QuotaExceededError || error instanceof PermissionDeniedError) throw error
      if (abort.signal.aborted) throw new MiniAppUnavailableError(`Request to ${url} timed out`)
      // Everything else is the REMOTE end failing — DNS, refused connection, TLS, a stream
      // that dies mid-body. Raw, the bridge answers `Internal` and blames the author's code.
      throw new MiniAppUnavailableError(`Request to ${url} failed: ${(error as Error).message}`)
    } finally {
      clearTimeout(timer)
      release()
    }
  }
}
