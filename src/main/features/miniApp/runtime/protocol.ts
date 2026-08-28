/**
 * `cherry-miniapp://<appId>/<path>` request handler.
 *
 * Registered ONLY on `persist:miniapp:<appId>` sessions — that is what keeps the
 * host renderer unable to address package files at all.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { MINI_APP_RESERVED_DIR, MINI_APP_SCHEME } from '@shared/types/miniAppManifest'

const logger = loggerService.withContext('miniAppProtocol')

// MINI_APP_SCHEME lives in `@shared/types/miniAppManifest`; re-declaring it here
// would be a second source for one value.

/**
 * `standard` is mandatory: without it the scheme yields an opaque origin, loses
 * relative-URL resolution, and Chromium disables localStorage/indexedDB for it.
 * `bypassCSP` stays false because CSP is one of the two network-containment
 * layers; service workers stay off because they survive navigation.
 */
export const MINI_APP_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  bypassCSP: false,
  allowServiceWorkers: false,
  // Required: CSP `sandbox` makes the document opaque-origin, so even reading
  // its own package counts as cross-origin and fetch() fails without this.
  corsEnabled: true
} as const

export const MINI_APP_SCHEME_DECLARATION = {
  scheme: MINI_APP_SCHEME,
  privileges: MINI_APP_PRIVILEGES
} as const

/**
 * The ONE CSP string. Sent on every response of this handler — the delivery path the
 * storage/WebRTC probes measured — and again by `webRequest.onHeadersReceived`
 * (`network.ts`), so the sandbox does not depend on whether Chromium routes a custom
 * scheme through webRequest. No hosts parameter: the document may not reach the network.
 */
export function buildMiniAppCsp(): string {
  return [
    // The ONLY measured mechanism that denies localStorage/IndexedDB, and its flags
    // propagate to nested contexts — closing the srcdoc/about:blank re-entry.
    `sandbox allow-scripts`,
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `media-src 'self' data: blob:`,
    // No allowlist at this layer at all: anything remote arrives via
    // `cherry.network.fetch` and reaches the page as a data: URL the script built.
    `connect-src 'none'`,
    `frame-src 'none'`,
    `worker-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'none'`
  ].join('; ')
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
}

/**
 * Bounds how many package reads can be in flight at once.
 *
 * The realpath check decides WHAT a guest may read; nothing decided HOW MUCH at a
 * time. A guest can issue arbitrarily many concurrent `fetch()`es for its own large
 * asset, and every one of them holds main-process memory. This is the same class of
 * limit as the quotas — a permission is not a rate.
 */
const MAX_CONCURRENT_READS = 8
/** An unbounded wait queue is the same denial of service one indirection later. */
const MAX_QUEUED_READS = 64
// Per app: shared across apps, a guest that spent the budget kept every other guest
// from loading so much as its index.html.
const readers = new Map<string, { active: number; queue: Array<() => void> }>()

function acquireReadSlot(appId: string): Promise<() => void> {
  const state = readers.get(appId) ?? { active: 0, queue: [] }
  readers.set(appId, state)
  // Idempotent: `finalize` may be reached from more than one path, and a release
  // that ran twice would hand out a slot that was never taken.
  const makeRelease = () => {
    let released = false
    return () => {
      if (released) return
      released = true
      state.active -= 1
      const next = state.queue.shift()
      if (next) next()
      else if (state.active === 0) readers.delete(appId)
    }
  }
  if (state.active < MAX_CONCURRENT_READS) {
    state.active += 1
    return Promise.resolve(makeRelease())
  }
  if (state.queue.length >= MAX_QUEUED_READS) {
    return Promise.reject(new Error('Too many concurrent mini app reads'))
  }
  return new Promise((resolve) =>
    state.queue.push(() => {
      state.active += 1
      resolve(makeRelease())
    })
  )
}

function reservedAsset(assetsDir: string, rest: string): { body: Buffer; type: string } | undefined {
  if (rest !== 'theme.css') return undefined
  return {
    body: fs.readFileSync(path.join(assetsDir, 'miniAppTheme.css')),
    type: 'text/css; charset=utf-8'
  }
}

/**
 * Bound to ONE appId. Anything else in the host position is a 404: a handler that
 * looked the host up in the install table could serve another app's package from
 * this partition. The webRequest allowlist blocks that today, but this is the
 * first layer and must not depend on the second.
 */
// Every response, errors included: CSP is inert on subresources but any package file can be
// navigated to as the top-level document, and a bare 404 from an opaque origin is a TypeError.
const BASE_HEADERS = { 'access-control-allow-origin': '*', 'content-security-policy': buildMiniAppCsp() }
const notFound = () => new Response('not found', { status: 404, headers: BASE_HEADERS })
const forbidden = () => new Response('forbidden', { status: 403, headers: BASE_HEADERS })

export function createMiniAppProtocolHandler(
  ownAppId: string,
  resolveInstallPath: (appId: string) => string | undefined,
  // Injectable only so the suite can point `/__cherry/*` at a fixture. Production
  // always takes the default — the third parameter is a test seam, not a feature.
  assetsDir: string = path.join(__dirname, 'assets')
): (request: Request) => Promise<Response> {
  return async (request) => {
    const { host, pathname } = new URL(request.url)
    if (host !== ownAppId) return notFound()
    // `decodeURIComponent` THROWS on a malformed escape (`fetch('%')` reaches here as `/%`),
    // and a throw out of this handler surfaces to the guest as `TypeError: Failed to fetch`
    // with no headers — the one thing sandbox.md promises never happens for a bad path.
    let rel: string
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '')
    } catch {
      return notFound()
    }

    // The reserved prefix never touches disk — resolved first, so a package that
    // smuggles in a `__cherry/` directory can never have it served.
    if (rel === MINI_APP_RESERVED_DIR || rel.startsWith(`${MINI_APP_RESERVED_DIR}/`)) {
      const asset = reservedAsset(assetsDir, rel.slice(MINI_APP_RESERVED_DIR.length + 1))
      if (!asset) return notFound()
      return new Response(asset.body as Uint8Array<ArrayBuffer>, {
        headers: {
          ...BASE_HEADERS,
          'content-type': asset.type,
          'cache-control': 'no-cache'
        }
      })
    }

    const installPath = resolveInstallPath(host)
    if (!installPath) return notFound()

    let root: string
    let real: string
    try {
      root = await fs.promises.realpath(installPath)
      real = await fs.promises.realpath(path.join(root, rel || 'index.html'))
    } catch {
      return notFound()
    }

    // realpath containment, NOT a string-prefix check on the pre-resolution path:
    // a symlink inside the package resolves cleanly under the naive comparison.
    if (real !== root && !real.startsWith(root + path.sep)) {
      logger.warn('Blocked mini app path escaping its package root', { appId: host, requested: rel })
      return forbidden()
    }

    // Same reason as the decode above: the file can vanish between `realpath` and here, and
    // an ENOENT thrown out of the handler is a `TypeError` at the guest instead of a 404.
    const stat = await fs.promises.stat(real).catch(() => null)
    if (!stat?.isFile()) return notFound()

    // Streamed, never `readFile`: the guest controls fetch frequency and concurrency,
    // so buffering lets it hold N copies of a 100 MB file in MAIN process memory.
    const release = await acquireReadSlot(host)
    let handle: fs.promises.FileHandle
    try {
      handle = await fs.promises.open(real, 'r')
    } catch (error) {
      // The slot was taken before the open. Losing it here leaks one permanently.
      release()
      throw error
    }

    // ONE finalizer reachable from every exit — normal end, stream error, cancel.
    // `flush` covers only the first: a cancelled fetch never calls it (Node 24).
    let finalized = false
    const finalize = () => {
      if (finalized) return
      finalized = true
      void handle.close()
      release()
    }

    const body = handle.readableWebStream() as unknown as ReadableStream<Uint8Array>
    return new Response(
      body.pipeThrough(
        // `cancel` is missing from the bundled lib.dom `Transformer` (TS 5.8); Node 24 honours it.
        new TransformStream({
          flush: finalize,
          cancel: finalize
        } as Transformer<Uint8Array, Uint8Array>)
      ),
      {
        headers: {
          ...BASE_HEADERS,
          'content-type': CONTENT_TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(stat.size)
        }
      }
    )
  }
}
