import dns from 'node:dns'
import { BlockList, isIP } from 'node:net'

import { application } from '@application'
import { MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import { net } from 'electron'
import * as z from 'zod'

import { MiniAppUnavailableError } from '../errors'
import { PermissionDeniedError } from '../grants'
import { installationOf } from '../install/installer'
import { networkHiddenBudget, networkLimiter, QuotaExceededError } from './quota'

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
 * `10.x`, `100.64.x` or `169.254.169.254` would turn the main process into an SSRF proxy.
 * IPv4-mapped IPv6 is checked against the IPv4 rules by `BlockList`; the translation
 * prefixes that embed an IPv4 address (NAT64, 6to4, Teredo) are refused whole.
 *
 * NOT listed on purpose: 198.18.0.0/15 (benchmarking). Fake-IP proxies such as Clash and
 * Surge answer every intercepted lookup from it, so refusing it refuses every fetch there.
 */
const NON_GLOBAL = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  NON_GLOBAL.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
] as const) {
  NON_GLOBAL.addSubnet(address, prefix, 'ipv6')
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  // Unparsable is refused, not passed: the lookup answer is the only thing this trusts.
  if (family === 0) return true
  return NON_GLOBAL.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/** In-flight exchanges per guest, so `forgetGuest` can end what a departed guest started. */
const inflight = new Map<number, Set<AbortController>>()

export const networkCapability = {
  async fetch(appId: string, params: unknown, senderId: number) {
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

    // Before the slot, for the same reason `acquire` is last: a throw after it leaks one.
    networkHiddenBudget.check(senderId, application.get('MiniAppRuntimeService').isGuestVisible(senderId))

    // Acquired LAST, right before the `try` that releases it: anything that throws between
    // `acquire` and `try` leaks a slot for good, and four leaks kill this app's networking.
    const release = networkLimiter.acquire(appId)
    const abort = new AbortController()
    // Covers the WHOLE exchange, not just the headers: a server that answers and then
    // dangles its body would otherwise hold a concurrency slot for ever.
    const timer = setTimeout(() => abort.abort('timeout'), MINI_APP_FETCH_TIMEOUT_MS)
    const owned = inflight.get(senderId) ?? new Set<AbortController>()
    owned.add(abort)
    inflight.set(senderId, owned)
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
      if (abort.signal.reason === 'guest')
        throw new MiniAppUnavailableError(`Request to ${url} abandoned: the guest went away`)
      if (abort.signal.aborted) throw new MiniAppUnavailableError(`Request to ${url} timed out`)
      // Everything else is the REMOTE end failing — DNS, refused connection, TLS, a stream
      // that dies mid-body. Raw, the bridge answers `Internal` and blames the author's code.
      throw new MiniAppUnavailableError(`Request to ${url} failed: ${(error as Error).message}`)
    } finally {
      clearTimeout(timer)
      owned.delete(abort)
      if (owned.size === 0) inflight.delete(senderId)
      release()
    }
  },

  /** The guest is gone and will never read the answer: stop paying the remote for it. */
  forgetGuest(senderId: number): void {
    for (const abort of inflight.get(senderId) ?? []) abort.abort('guest')
    inflight.delete(senderId)
  }
}
