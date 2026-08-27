import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

import { loggerService } from '@logger'
import { net } from 'electron'

const logger = loggerService.withContext('localModelDownloadEngine')

/**
 * The one way bytes enter the local-model directories: try each mirror in turn,
 * stream to a temp file while hashing, and only rename into place once the digest
 * matches. Everything downloadable — model files and the shared runtime tarball —
 * goes through {@link withMirrorFallback} and {@link streamToFileVerified}.
 */

/**
 * Run `attempt` against each URL until one succeeds. A mirror that is unreachable and
 * one that serves corrupt bytes fail identically here, so a bad-but-live mirror can
 * never make the whole download terminal while another mirror still has good bytes —
 * which is why verification belongs inside the attempt rather than after this loop.
 *
 * Abort is not a mirror failure: a cancelled download must stop, not walk the rest of
 * the list re-issuing requests that will be aborted too.
 */
export async function withMirrorFallback<T>(
  urls: readonly string[],
  signal: AbortSignal,
  label: string,
  attempt: (url: string) => Promise<T>
): Promise<T> {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await attempt(url)
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
      logger.warn(`mirror failed for ${label}, trying next`, { url, error: String(error) })
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to download ${label} from every mirror`)
}

/**
 * Stream `url` into `dest`, verifying sha256 as the bytes go by. Writes through
 * `${dest}.tmp` and renames only after the digest matches, so a failed or cancelled
 * attempt leaves nothing for a later readiness probe to mistake for a real file.
 *
 * The digest replaces the size floor the download path used to rely on: a truncated
 * response, an LFS pointer and a captive-portal page all fail it, and unlike a floor
 * it also catches a corrupted body of exactly the right length.
 */
export async function streamToFileVerified(
  url: string,
  dest: string,
  options: { sha256: string; signal: AbortSignal; onProgress?: (fraction: number) => void }
): Promise<void> {
  const { sha256, signal, onProgress } = options
  const response = await net.fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

  const total = Number(response.headers.get('content-length')) || 0
  const hash = crypto.createHash('sha256')
  const tmp = `${dest}.tmp`
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      hash.update(chunk)
      if (total > 0) onProgress?.(received / total)
      callback(null, chunk)
    }
  })

  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  try {
    // net.fetch's body is the DOM ReadableStream; Readable.fromWeb wants the
    // node:stream/web flavour — same runtime object, divergent lib types.
    const webStream = response.body as unknown as NodeWebReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(webStream), meter, fs.createWriteStream(tmp), { signal })
    const digest = hash.digest('hex')
    if (digest !== sha256) {
      throw new Error(`sha256 mismatch for ${url}: expected ${sha256}, got ${digest}`)
    }
    await fs.promises.rename(tmp, dest)
  } catch (error) {
    await fs.promises.rm(tmp, { force: true })
    throw error
  }
  onProgress?.(1)
}

/**
 * Fetch `url` as text and verify its sha256. For the small config files whose bytes are
 * transformed before landing on disk, where streaming to a file would only mean writing
 * something that is not the artifact anyway.
 */
export async function fetchTextVerified(
  url: string,
  options: { sha256: string; signal: AbortSignal }
): Promise<string> {
  const response = await net.fetch(url, { signal: options.signal })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const body = Buffer.from(await response.arrayBuffer())
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  if (digest !== options.sha256) {
    throw new Error(`sha256 mismatch for ${url}: expected ${options.sha256}, got ${digest}`)
  }
  return body.toString('utf8')
}

/** Write `text` to `dest` through a temp file, so a crash mid-write cannot leave a
 * half-written file that looks installed. */
export async function writeFileAtomic(dest: string, text: string): Promise<void> {
  const tmp = `${dest}.tmp`
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(tmp, text)
  await fs.promises.rename(tmp, dest)
}
