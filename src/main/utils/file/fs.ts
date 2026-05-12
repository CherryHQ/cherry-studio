/* oxlint-disable no-unused-vars -- TODO(phase-2): compressImage is the last remaining stub; its parameters shape the public signature but are unused until the KnowledgeService consumer migrates. */

/**
 * Core filesystem operations — the ONLY module that imports `node:fs`.
 *
 * All functions are pure path-based, no entry/DB awareness.
 *
 * ## Consumer responsibility
 *
 * `@main/utils/file/fs` is open to the entire main process and performs no
 * entry-awareness checks. Callers MUST NOT use this module (directly or via a
 * `FilePathHandle`) to write or mutate paths under `{userData}/Data/Files/` —
 * those back internal-origin `FileEntry` rows whose `size` column is
 * authoritative and kept in sync only by FileManager's atomic write path.
 * Bypassing it silently desyncs `file_entry.size` from disk and leaves
 * `versionCache` stale, with no type-system or runtime guard.
 *
 * For writes targeting a FileEntry (internal or external), go through
 * `FileManager.write` / `writeIfUnchanged` / `createWriteStream`. Legitimate
 * consumers of these primitives outside the file module (BootConfig, MCP
 * oauth, user-picked external paths, temporary artifacts, etc.) are
 * unaffected — the rule is specifically "do not point writes at the internal
 * storage tree".
 *
 * See `docs/references/file/architecture.md §5.2` for the full rationale.
 */

import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream as nodeCreateWriteStream } from 'node:fs'
import {
  access,
  constants,
  mkdir as fsMkdirPromise,
  open as fsOpen,
  readFile,
  rename,
  rm as fsRm,
  stat as fsStat,
  unlink
} from 'node:fs/promises'
import path from 'node:path'
import { Writable } from 'node:stream'

import { loggerService } from '@logger'
import type { FilePath } from '@shared/file/types'
import mime from 'mime'
import xxhashLoader from 'xxhash-wasm'

const logger = loggerService.withContext('utils/file/fs')

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/fs.${op}: not implemented (deferred to Phase 2)`)
}

/** Read file content as text with optional encoding detection. */
export async function read(path: FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
export async function read(path: FilePath, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
export async function read(path: FilePath, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>
export async function read(
  path: FilePath,
  options?: { encoding?: 'text' | 'base64' | 'binary'; detectEncoding?: boolean }
): Promise<unknown> {
  const encoding = options?.encoding ?? 'text'
  if (encoding === 'text') {
    return readFile(path, 'utf-8')
  }
  const buf = await readFile(path)
  const inferredMime = mime.getType(path) ?? 'application/octet-stream'
  if (encoding === 'base64') {
    return { data: buf.toString('base64'), mime: inferredMime }
  }
  return { data: new Uint8Array(buf), mime: inferredMime }
}

/** Returns true iff the path exists and is readable by the current process. */
export async function exists(path: FilePath): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Whether two paths resolve to the same physical file. Compares POSIX
 * `(device, inode)` — does NOT follow symlinks (`stat`, not `realpath`).
 *
 * Primary use case: distinguishing a case-only rename on a case-insensitive
 * filesystem (macOS APFS / Windows NTFS) from a true name collision. On such
 * filesystems `exists('foo.pdf')` returns true when only `Foo.pdf` is on disk,
 * which would otherwise falsely block a `Foo.pdf → foo.pdf` rename.
 *
 * Returns false if either path does not exist (ENOENT — the expected miss)
 * or stat fails for any other reason. Non-ENOENT failures are warn-logged
 * here so downstream call sites that interpret `false` as "different file"
 * leave a breadcrumb pointing at the real cause — e.g. `rename.ts` then
 * throws `"target path already exists"` after `exists(target) && !isSameFile(...)`,
 * a message that would otherwise mask the underlying permission /
 * symlink-loop / fd-exhaustion error invisibly.
 */
export async function isSameFile(a: FilePath, b: FilePath): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fsStat(a), fsStat(b)])
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logger.warn('isSameFile: stat failed, treating as different file', { a, b, code, err })
    }
    return false
  }
}

/** Write content to a file path. Atomic — never produces partially-written targets. */
export async function write(target: FilePath, data: string | Uint8Array): Promise<void> {
  return atomicWriteFile(target, data)
}

function tmpNameFor(target: string): string {
  return `${target}.tmp-${randomUUID()}`
}

/**
 * Whether an errno from a directory-fsync attempt should be silently
 * swallowed instead of warn-logged. Only codes that mean "this FS semantically
 * rejects directory fsync" qualify — EINVAL / EISDIR / ENOTSUP all come from
 * Windows, FUSE, or network mounts that don't expose dir-handle sync. EPERM /
 * EACCES intentionally do NOT qualify: those usually mean the userData
 * directory's ACL drifted (sandbox containment shift, SELinux/AppArmor
 * tightening, manual chown), and silently skipping the dashboard signal would
 * mask the regression. Exported for direct unit coverage of the classification.
 * @internal
 */
export function shouldSilenceFsyncDirError(code: string | undefined): boolean {
  return code === 'EINVAL' || code === 'EISDIR' || code === 'ENOTSUP'
}

/**
 * fsync(2) the directory containing `target` so the rename's directory-entry
 * update reaches stable storage. Best-effort: returns silently when the FS
 * doesn't support directory fsync (Windows, network mounts, some FUSE
 * backends), and warn-logs when the failure looks like a real IO problem
 * (EIO, ENOSPC, …) so an unexpected loss of durability is at least visible
 * in oncall dashboards. The rename itself has already committed; the caller
 * doesn't need to fail just because the metadata flush couldn't be confirmed.
 */
async function fsyncDirectoryOf(target: string): Promise<void> {
  try {
    const dirHandle = await fsOpen(path.dirname(target), 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (shouldSilenceFsyncDirError(code)) return
    logger.warn('fsync(dir) failed after atomic rename; durability not confirmed', { target, code, err })
  }
}

/** Path-level version captured from `fs.stat`. Mirrors `FileVersion`'s shape but lives here so this module is self-contained. */
export interface PathVersion {
  mtime: number
  size: number
}

/**
 * Path-level version-mismatch error. Thrown by `atomicWriteIfUnchanged`.
 *
 * `internal/content/write.writeIfUnchanged` catches this and re-wraps it in
 * the entry-aware `StaleVersionError` exported by `FileManager.ts`.
 */
export class PathStaleVersionError extends Error {
  constructor(
    public readonly target: FilePath,
    public readonly expected: PathVersion,
    public readonly current: PathVersion
  ) {
    super(
      `Path ${target} version mismatch: expected mtime=${expected.mtime} size=${expected.size}, ` +
        `got mtime=${current.mtime} size=${current.size}`
    )
    this.name = 'PathStaleVersionError'
  }
}

/**
 * Atomic write: tmp + fsync + rename + fsync(dir).
 *
 * Follows the POSIX atomic flow documented in
 * `docs/references/file/file-manager-architecture.md §5.1`:
 * 1. open `{target}.tmp-{uuid}` in the same directory
 * 2. write data, fsync the tmp fd
 * 3. rename(tmp, target) — atomic replacement on POSIX
 * 4. fsync(dir fd) — flush rename metadata; ignored on Windows
 *
 * Any failure between open and rename (writeFile / sync / rename itself)
 * best-effort unlinks the tmp file before rethrowing. orphanSweep only
 * collects UUID-named files in the entry tree, so a leaked `.tmp-{uuid}`
 * here would persist indefinitely. The target file is never partially
 * written — callers either see the previous content or the new content.
 */
export async function atomicWriteFile(target: FilePath, data: string | Uint8Array): Promise<void> {
  const tmp = tmpNameFor(target)
  const tmpHandle = await fsOpen(tmp, 'w')
  try {
    try {
      await tmpHandle.writeFile(data)
      await tmpHandle.sync()
    } catch (err) {
      await tmpHandle.close().catch(() => undefined)
      await unlink(tmp).catch(() => undefined)
      throw err
    }
    await tmpHandle.close()
  } catch (err) {
    // tmpHandle.close() above can throw on its own; if it does, the tmp
    // file is still on disk and must be cleaned up here.
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  try {
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  await fsyncDirectoryOf(target)
}

/**
 * Atomic write stream — pipes through a tmp file and renames onto the target
 * on `.end()`. On `.destroy(err)` or `.abort()` the tmp file is unlinked and
 * no rename happens, so the target is either untouched or fully replaced.
 *
 * The stream is a Writable that consumers can `pipe()` into. `.abort()` is
 * the explicit "cancel" entry point — awaitable; idempotent. See
 * `FileManager.AtomicWriteStream` JSDoc for the full lifecycle contract.
 */
export interface AtomicWriteStream extends Writable {
  abort(): Promise<void>
}

class AtomicWriteStreamImpl extends Writable implements AtomicWriteStream {
  private readonly target: string
  private readonly tmp: string
  private readonly underlying: ReturnType<typeof nodeCreateWriteStream>
  private aborted = false
  private committed = false

  constructor(target: string) {
    super()
    this.target = target
    this.tmp = tmpNameFor(target)
    this.underlying = nodeCreateWriteStream(this.tmp)
    this.underlying.on('error', (err) => this.destroy(err))
  }

  override _write(chunk: unknown, encoding: BufferEncoding, callback: (err?: Error | null) => void): void {
    this.underlying.write(chunk as Buffer | string, encoding, callback)
  }

  override _final(callback: (err?: Error | null) => void): void {
    this.underlying.end(async () => {
      try {
        const fd = await fsOpen(this.tmp, 'r+')
        try {
          await fd.sync()
        } finally {
          await fd.close()
        }
        await rename(this.tmp, this.target)
        await fsyncDirectoryOf(this.target)
        this.committed = true
        callback()
      } catch (err) {
        await unlink(this.tmp).catch(() => undefined)
        callback(err as Error)
      }
    })
  }

  override _destroy(err: Error | null, callback: (err: Error | null) => void): void {
    if (this.committed) {
      callback(err)
      return
    }
    const cleanup = () => {
      unlink(this.tmp)
        .catch(() => undefined)
        .finally(() => callback(err))
    }
    if (this.underlying.destroyed) {
      cleanup()
    } else {
      this.underlying.once('close', cleanup)
      this.underlying.destroy()
    }
  }

  async abort(): Promise<void> {
    if (this.aborted || this.committed) return
    this.aborted = true
    return new Promise<void>((resolve) => {
      this.once('close', () => resolve())
      this.destroy()
    })
  }
}

/**
 * Create an `AtomicWriteStream` that buffers to a tmp file and atomically
 * commits onto `target` on `.end()`. See `AtomicWriteStream` JSDoc for the
 * full lifecycle contract.
 */
export function createAtomicWriteStream(target: FilePath): AtomicWriteStream {
  return new AtomicWriteStreamImpl(target)
}

/**
 * Optimistic-concurrency atomic write.
 *
 * Re-stats the target and compares against `expected`:
 * - byte-exact `(mtime, size)` match → write proceeds via `atomicWriteFile`
 * - mismatch → throws `PathStaleVersionError` without touching the target
 * - **ambiguous** (`mtime ms === 0` AND `size === expected.size`) → second-
 *   precision FS scenario; the implementation needs `expectedContentHash` to
 *   distinguish "same file" from "stealth edit". When omitted the write
 *   proceeds (no false-positive throw); when supplied a content-hash fallback
 *   compares before deciding.
 *
 * Returns the new on-disk version on success.
 */
export async function atomicWriteIfUnchanged(
  target: FilePath,
  data: string | Uint8Array,
  expected: PathVersion,
  expectedContentHash?: string
): Promise<PathVersion> {
  const s = await fsStat(target)
  const current: PathVersion = { mtime: Math.floor(s.mtimeMs), size: s.size }
  const sizeMatch = current.size === expected.size
  const mtimeMatch = current.mtime === expected.mtime
  if (!(sizeMatch && mtimeMatch)) {
    throw new PathStaleVersionError(target, expected, current)
  }
  const ambiguousMtime = current.mtime % 1000 === 0 && expected.mtime % 1000 === 0
  if (ambiguousMtime && expectedContentHash !== undefined) {
    const actualHash = await hash(target)
    if (actualHash !== expectedContentHash) {
      throw new PathStaleVersionError(target, expected, current)
    }
  }
  await atomicWriteFile(target, data)
  const s2 = await fsStat(target)
  return { mtime: Math.floor(s2.mtimeMs), size: s2.size }
}

/** Get file/directory stats. */
export async function stat(
  path: FilePath
): Promise<{ size: number; createdAt: number; modifiedAt: number; isDirectory: boolean }> {
  const s = await fsStat(path)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory()
  }
}

/** Copy a file from source to destination atomically (tmp + rename on dest). */
export async function copy(src: FilePath, dest: FilePath): Promise<void> {
  const reader = createReadStream(src)
  const writer = createAtomicWriteStream(dest)
  await new Promise<void>((resolve, reject) => {
    reader.on('error', (err) => {
      writer.destroy(err)
      reject(err)
    })
    writer.on('error', reject)
    writer.on('finish', resolve)
    reader.pipe(writer)
  })
}

/**
 * Move/rename a file. Tries `rename` first (atomic on the same filesystem);
 * falls back to copy + unlink on `EXDEV` (cross-mount).
 *
 * The cross-device fallback resolves to a successful move only if `unlink(src)`
 * also succeeds — otherwise the caller has two files on disk with identical
 * content. `unlink` failures other than `ENOENT` (src already gone, fine) are
 * warn-logged with the path pair so oncall can locate the stranded source
 * after a partial move. The function still resolves: the move has otherwise
 * succeeded (dest is fully written), and forcing callers to handle an "almost
 * moved" exception would conflate "copy failed" with "cleanup failed".
 */
export async function move(src: FilePath, dest: FilePath): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copy(src, dest)
    try {
      await unlink(src)
    } catch (unlinkErr) {
      const code = (unlinkErr as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn('move: cross-device copy succeeded but source unlink failed; src remains on disk', {
          src,
          dest,
          code,
          err: unlinkErr
        })
      }
    }
  }
}

/** Remove a file. Idempotent on `ENOENT`. */
export async function remove(target: FilePath): Promise<void> {
  try {
    await unlink(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/** Remove a directory recursively. Idempotent on missing path. */
export async function removeDir(target: FilePath): Promise<void> {
  await fsRm(target, { recursive: true, force: true })
}

/** Create a single directory. Throws if it already exists. */
export async function mkdir(target: FilePath): Promise<void> {
  await fsMkdirPromise(target)
}

/** Ensure a directory exists, creating any missing ancestors. Idempotent. */
export async function ensureDir(target: FilePath): Promise<void> {
  await fsMkdirPromise(target, { recursive: true })
}

/** Compress an image (sharp). Returns the output path. */
export async function compressImage(_input: FilePath | Uint8Array, _output: FilePath): Promise<void> {
  return notImplemented('compressImage')
}

/**
 * Download `url` to `dest`. Streams the response body into an atomic writer
 * (tmp + rename), so an interrupted download leaves no partially-written
 * dest file. Throws on non-2xx responses.
 */
export async function download(url: string, dest: FilePath): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download(${url}): HTTP ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error(`download(${url}): response has no body`)
  }
  const writer = createAtomicWriteStream(dest)
  const reader = response.body.getReader()
  await new Promise<void>((resolve, reject) => {
    writer.on('error', (err) => {
      // Cancel the reader so the underlying TCP socket / ReadableStream lock
      // is released — otherwise a writer-side failure (fsync, rename, disk
      // full) leaves the in-flight reader holding resources until GC.
      reader.cancel(err).catch(() => undefined)
      reject(err)
    })
    writer.on('finish', resolve)
    const pump = async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) {
            writer.end()
            return
          }
          if (!writer.write(Buffer.from(value))) {
            await new Promise<void>((r) => writer.once('drain', r))
          }
        }
      } catch (err) {
        writer.destroy(err as Error)
      }
    }
    void pump()
  })
}

/**
 * Compute the content hash of a file (streaming).
 *
 * Algorithm: xxhash-h64 — non-cryptographic, ~10× faster than MD5, and the
 * `writeIfUnchanged` precision-fallback only needs collision resistance under
 * a single file's write history (which h64 trivially satisfies).
 *
 * The architecture doc names xxhash-128 as the conceptual contract; the
 * `xxhash-wasm` package available at this version exposes only h32 / h64,
 * so we ship h64 and revisit if a 128-bit variant becomes necessary.
 */
let xxhashApi: Awaited<ReturnType<typeof xxhashLoader>> | undefined
async function getXxhash() {
  if (!xxhashApi) xxhashApi = await xxhashLoader()
  return xxhashApi
}

export async function hash(path: FilePath): Promise<string> {
  const api = await getXxhash()
  const hasher = api.create64()
  const stream = createReadStream(path)
  for await (const chunk of stream) {
    hasher.update(new Uint8Array(chunk as Buffer))
  }
  return hasher.digest().toString(16).padStart(16, '0')
}
