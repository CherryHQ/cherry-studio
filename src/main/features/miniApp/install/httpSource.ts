/**
 * HTTPS-only fetch for remote packages. Kept in its own module so the update
 * policy can be tested without touching the network.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { regionService } from '@main/services/RegionService'
import {
  MINI_APP_MAX_ICON_BYTES,
  MINI_APP_MAX_MANIFEST_BYTES,
  MINI_APP_MAX_PACKAGE_BYTES,
  type MiniAppDistributionManifest,
  MiniAppDistributionManifestSchema
} from '@shared/types/miniAppManifest'
import { net } from 'electron'

// One cleanup policy for the whole feature: best-effort, logged, never masking.
import { bestEffortCleanup } from './cleanup'

const logger = loggerService.withContext('miniApp:httpSource')

/** Whole exchange for the small, bounded fetches (manifest, icon). */
export const MINI_APP_SOURCE_TIMEOUT_MS = 30_000
/** Silence, not duration, ends a package download: a slow link stays alive by sending. */
export const MINI_APP_DOWNLOAD_IDLE_MS = 60_000

/** An abort that fires `ms` after the last `bump()` — a whole-exchange deadline when never bumped. */
function deadline(ms: number) {
  const abort = new AbortController()
  let timer = setTimeout(() => abort.abort(), ms)
  return {
    signal: abort.signal,
    bump: () => {
      clearTimeout(timer)
      timer = setTimeout(() => abort.abort(), ms)
    },
    clear: () => clearTimeout(timer)
  }
}

/** Origin and path only: presigned urls carry their credential in the query, and warn logs persist. */
function loggable(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return 'invalid url'
  }
}

export function assertHttps(url: string): URL {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`Mini app source must be https: ${loggable(url)}`)
  return parsed
}

/**
 * Mirrors in region order, the other as fallback — the shape every downloading feature
 * in this repo already uses (`BinaryManager`, `OnnxRuntimeBinaryService`,
 * `modelSource.ts`, `JinaProvider`). A single global URL is unreachable for a whole
 * region of users, and the machinery to avoid that already exists.
 *
 * Either order is safe because `sha256` verifies the BYTES, not the host that served
 * them — the same reasoning `ONNXRUNTIME_TARBALL_SHA256` is documented with.
 */
export async function mirrorOrder(url: string, urlCn: string | undefined): Promise<string[]> {
  if (!urlCn) return [url]
  // `.catch(() => false)`: region detection is a network call of its own, and failing
  // it must degrade to the global default rather than fail the download.
  return (await regionService.isInChina().catch(() => false)) ? [urlCn, url] : [url, urlCn]
}

/**
 * First mirror that succeeds wins; the LAST error is the one that surfaces.
 *
 * Rethrowing the first would bury the fallback's failure behind the region default's,
 * and the fallback is the one a user can usually act on. An integrity failure on one
 * mirror does not fail the whole download — `sha256` still gates what lands — but it
 * is logged, because a mirror serving different bytes is worth knowing about.
 */
async function tryMirrors<T>(urls: readonly string[], attempt: (url: string) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await attempt(url)
    } catch (error) {
      lastError = error
      logger.warn('Mini app download mirror failed', { url: loggable(url), error })
    }
  }
  throw lastError
}

/**
 * The manifest at `update.url` — the DISTRIBUTION one, so `package` is required.
 *
 * A source that omits it leaves the download self-certifying: nothing would bind the
 * bytes that land to the manifest the user reviewed.
 */
export function fetchManifest(urls: readonly string[]): Promise<MiniAppDistributionManifest> {
  return tryMirrors(urls, fetchManifestFrom)
}

/**
 * The manifest is untrusted input from a remote source, so it is counted while it
 * arrives and only parsed once it is known to be small. `res.json()` would read the
 * whole body into the main process before any size check could apply — the same
 * mistake the package download used to make, at a smaller scale but on a response
 * that is fetched far more often.
 */
async function fetchManifestFrom(url: string): Promise<MiniAppDistributionManifest> {
  assertHttps(url)
  // `credentials: 'omit'` is as mandatory here as in `cherry.network.fetch` (design §8) —
  // a third-party URL, and Electron sends session auth when unset (`electron.d.ts:20240`).
  const { signal, clear } = deadline(MINI_APP_SOURCE_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { credentials: 'omit', redirect: 'error', signal })
    if (!res.ok) throw new Error(`Failed to fetch mini app manifest: ${res.status}`)

    const chunks: Uint8Array[] = []
    let received = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > MINI_APP_MAX_MANIFEST_BYTES) {
        throw new Error(`Manifest exceeds the ${MINI_APP_MAX_MANIFEST_BYTES} byte limit`)
      }
      chunks.push(chunk)
    }
    return MiniAppDistributionManifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } finally {
    clear()
  }
}

/**
 * A downloaded package plus the ONLY way to dispose of it.
 *
 * Returning a bare path would leave callers to infer what else they own — and the
 * obvious inference, "the parent directory is mine", is a recursive delete aimed at
 * whatever directory the path happens to sit in. The resource owns its own cleanup
 * so no caller ever computes a directory to remove.
 */
export interface DownloadedPackage {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Downloads and verifies against the EXPECTATION carried by the signed-off manifest.
 * Hashing whatever arrives and calling it the content hash certifies nothing.
 *
 * Streamed, counted and hashed as it arrives: buffering the whole body first would
 * let a hostile or runaway source exhaust main-process memory BEFORE the size check
 * it is supposed to fail. `Content-Length` is only a cheap early reject — it is
 * attacker-controlled, so the running count is what actually enforces the cap.
 */
export function fetchPackage(
  urls: readonly string[],
  expected: { sha256: string; size: number; origins: readonly string[] },
  /** Bytes so far against the declared size — what the tile's progress wedge draws. */
  onProgress?: (received: number, total: number) => void
): Promise<DownloadedPackage> {
  return tryMirrors(urls, (url) => fetchPackageFrom(url, expected, onProgress))
}

async function fetchPackageFrom(
  url: string,
  expected: { sha256: string; size: number; origins: readonly string[] },
  onProgress?: (received: number, total: number) => void
): Promise<DownloadedPackage> {
  const parsed = assertHttps(url)
  // Pinning covers the PAYLOAD, not only the pointer: validating just `update.url`
  // leaves `package.url` free. Required parameter so no call site can forget it.
  if (!expected.origins.includes(parsed.origin)) {
    throw new Error(`Package origin ${parsed.origin} is not one of the pinned ${expected.origins.join(', ')}`)
  }
  if (expected.size > MINI_APP_MAX_PACKAGE_BYTES) {
    throw new Error(`Package declares ${expected.size} bytes, over the ${MINI_APP_MAX_PACKAGE_BYTES} limit`)
  }

  const idle = deadline(MINI_APP_DOWNLOAD_IDLE_MS)
  try {
    return await downloadPackage(url, expected, idle, onProgress)
  } finally {
    idle.clear()
  }
}

async function downloadPackage(
  url: string,
  expected: { sha256: string; size: number; origins: readonly string[] },
  idle: ReturnType<typeof deadline>,
  onProgress?: (received: number, total: number) => void
): Promise<DownloadedPackage> {
  const res = await net.fetch(url, { credentials: 'omit', redirect: 'error', signal: idle.signal })
  if (!res.ok) throw new Error(`Failed to download mini app package: ${res.status}`)
  const advertised = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(advertised) && advertised > expected.size) {
    throw new Error(`Package advertises ${advertised} bytes, more than the declared ${expected.size}`)
  }

  const dir = await fs.promises.mkdtemp(path.join(application.getPath('app.temp'), 'miniapp-dl-'))
  const dest = path.join(dir, 'package.miniapp')
  const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true })

  try {
    const hash = createHash('sha256')
    const handle = await fs.promises.open(dest, 'w')
    let received = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        idle.bump()
        received += chunk.byteLength
        if (received > expected.size) {
          throw new Error(`Package exceeds the declared ${expected.size} bytes`)
        }
        hash.update(chunk)
        await handle.write(chunk)
        onProgress?.(received, expected.size)
      }
    } finally {
      await handle.close()
    }

    if (received !== expected.size) {
      throw new Error(`Package size mismatch: expected ${expected.size}, got ${received}`)
    }
    const actual = hash.digest('hex')
    if (actual !== expected.sha256) {
      throw new Error(`Package hash mismatch: expected ${expected.sha256}, got ${actual}`)
    }
    return { path: dest, cleanup }
  } catch (error) {
    // Best-effort: the ORIGINAL download error is the result, not a follow-on rm error.
    await bestEffortCleanup('failed download', cleanup)
    throw error
  }
}

/**
 * The consent card's icon, fetched on its own so the card can show it BEFORE the package
 * downloads. Pinned like the package, bounded like the packaged icon, and verified against
 * the digest the manifest already carries — the card never shows a face the package
 * cannot prove. Buffered, not streamed to disk: the cap is small and nothing keeps it.
 */
export async function fetchIcon(
  url: string,
  expected: { sha256: string; origins: readonly string[] }
): Promise<Buffer> {
  const parsed = assertHttps(url)
  if (!expected.origins.includes(parsed.origin)) {
    throw new Error(`Icon origin ${parsed.origin} is not one of the pinned ${expected.origins.join(', ')}`)
  }
  const { signal, clear } = deadline(MINI_APP_SOURCE_TIMEOUT_MS)
  const chunks: Uint8Array[] = []
  try {
    const res = await net.fetch(url, { credentials: 'omit', redirect: 'error', signal })
    if (!res.ok) throw new Error(`Failed to fetch mini app icon: ${res.status}`)

    let received = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > MINI_APP_MAX_ICON_BYTES) throw new Error(`Icon exceeds the ${MINI_APP_MAX_ICON_BYTES} byte limit`)
      chunks.push(chunk)
    }
  } finally {
    clear()
  }
  const bytes = Buffer.concat(chunks)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected.sha256) throw new Error(`Icon hash mismatch: expected ${expected.sha256}, got ${actual}`)
  return bytes
}
