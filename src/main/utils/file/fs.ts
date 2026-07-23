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

import { isUtf8 } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream as nodeCreateWriteStream, type Stats } from 'node:fs'
import {
  access,
  constants,
  type FileHandle,
  link,
  lstat as fsLstat,
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
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import type { FilePath } from '@shared/types/file'
import mime from 'mime'
import xxhashLoader from 'xxhash-wasm'

const logger = loggerService.withContext('utils/file/fs')
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024
const PUBLISH_COPY_CHUNK_BYTES = 64 * 1024
const CLEANUP_CHILD_MAX_BUFFER_BYTES = 4 * 1024
const CLEANUP_CHILD_TIMEOUT_MS = 2_000
const HARD_LINK_FALLBACK_CODES = new Set(['EACCES', 'EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'])
const UNLINK_OWNED_PATH_SCRIPT = String.raw`
'use strict'
const fs = require('node:fs')
const [leafName, expectedParentDev, expectedParentIno, expectedFileDev, expectedFileIno] = process.argv.slice(1)
const invalidLeaf =
  !leafName ||
  leafName === '.' ||
  leafName === '..' ||
  leafName.includes(String.fromCharCode(0)) ||
  leafName.includes('/') ||
  leafName.includes(String.fromCharCode(92))

if (invalidLeaf) process.exit(64)

try {
  const parent = fs.lstatSync('.')
  if (
    !parent.isDirectory() ||
    String(parent.dev) !== expectedParentDev ||
    String(parent.ino) !== expectedParentIno
  ) {
    process.exit(65)
  }

  const target = fs.lstatSync(leafName)
  if (
    !target.isFile() ||
    String(target.dev) !== expectedFileDev ||
    String(target.ino) !== expectedFileIno
  ) {
    process.exit(66)
  }

  fs.unlinkSync(leafName)
} catch (error) {
  if (error && error.code === 'ENOENT') process.exit(0)
  process.stderr.write(String((error && error.code) || error).slice(0, 512))
  process.exit(1)
}
`

function runUnlinkOwnedPathChild(
  parentPath: string,
  leafName: string,
  parent: Stats,
  file: Pick<Stats, 'dev' | 'ino'>
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT
  }

  return new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        '-e',
        UNLINK_OWNED_PATH_SCRIPT,
        '--',
        leafName,
        String(parent.dev),
        String(parent.ino),
        String(file.dev),
        String(file.ino)
      ],
      {
        cwd: parentPath,
        encoding: 'utf8',
        env,
        maxBuffer: CLEANUP_CHILD_MAX_BUFFER_BYTES,
        timeout: CLEANUP_CHILD_TIMEOUT_MS,
        windowsHide: true
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        reject(Object.assign(error, { stderr }))
      }
    )
  })
}

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

/**
 * Read a bounded regular file through a no-follow descriptor.
 *
 * The preliminary `lstat` rejects directories, FIFOs, sockets, and devices
 * without opening them. `O_NONBLOCK` closes the remaining race where a regular
 * file is replaced by a FIFO between that check and `open`, while
 * `O_NOFOLLOW` prevents a last-component symlink swap. The descriptor is then
 * checked again and read in bounded chunks so growth during the read cannot
 * allocate beyond `maxBytes + 1`.
 */
export async function readBoundedRegularFile(
  target: FilePath,
  options: { maxBytes: number; signal?: AbortSignal }
): Promise<string> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer')
  }

  options.signal?.throwIfAborted()
  const initialPathStat = await fsLstat(target)
  if (!initialPathStat.isFile()) {
    throw new Error(`Path is not a regular file: ${target}`)
  }
  if (initialPathStat.size > options.maxBytes) {
    throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const nonBlock = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0
  const handle = await fsOpen(target, constants.O_RDONLY | noFollow | nonBlock)

  try {
    const openedStat = await handle.stat()
    if (!openedStat.isFile()) {
      throw new Error(`Path is not a regular file: ${target}`)
    }
    if (openedStat.dev !== initialPathStat.dev || openedStat.ino !== initialPathStat.ino) {
      throw new Error(`Path changed while being opened: ${target}`)
    }
    if (openedStat.size > options.maxBytes) {
      throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
    }

    const chunks: Buffer[] = []
    let totalBytes = 0
    for (;;) {
      options.signal?.throwIfAborted()
      const remainingWithOverflowByte = options.maxBytes - totalBytes + 1
      const buffer = Buffer.allocUnsafe(Math.min(BOUNDED_READ_CHUNK_BYTES, remainingWithOverflowByte))
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break

      totalBytes += bytesRead
      if (totalBytes > options.maxBytes) {
        throw new Error(`File exceeds the ${options.maxBytes}-byte read limit: ${target}`)
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }

    options.signal?.throwIfAborted()
    const finalOpenedStat = await handle.stat()
    if (
      finalOpenedStat.dev !== openedStat.dev ||
      finalOpenedStat.ino !== openedStat.ino ||
      finalOpenedStat.size !== openedStat.size ||
      finalOpenedStat.mtimeMs !== openedStat.mtimeMs ||
      finalOpenedStat.ctimeMs !== openedStat.ctimeMs
    ) {
      throw new Error(`File changed while being read: ${target}`)
    }

    const finalPathStat = await fsLstat(target)
    if (
      !finalPathStat.isFile() ||
      finalPathStat.dev !== finalOpenedStat.dev ||
      finalPathStat.ino !== finalOpenedStat.ino ||
      finalPathStat.size !== finalOpenedStat.size ||
      finalPathStat.mtimeMs !== finalOpenedStat.mtimeMs ||
      finalPathStat.ctimeMs !== finalOpenedStat.ctimeMs
    ) {
      throw new Error(`Path changed while being read: ${target}`)
    }

    const data = Buffer.concat(chunks, totalBytes)
    if (!isUtf8(data)) throw new Error(`File is not valid UTF-8 text: ${target}`)
    const text = data.toString('utf8')
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } finally {
    await handle.close()
  }
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

/** Outcome of a readability probe: present, genuinely absent, or could-not-be-checked. */
export type PathReadability = 'readable' | 'missing' | 'unverifiable'

/**
 * Like {@link exists}, but distinguishes a path that is genuinely absent (`ENOENT` → `missing`)
 * from one that could not be checked (`EACCES` / `EMFILE` / `EIO` / a network-drive timeout →
 * `unverifiable`). Callers that drive a destructive remediation off "absent" — e.g. telling the
 * user to delete and re-add a source — need this so a transient failure is not reported as deletion.
 */
export async function probeReadable(path: FilePath): Promise<PathReadability> {
  try {
    await access(path, constants.R_OK)
    return 'readable'
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unverifiable'
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
 * Entry-aware writes catch this and re-wrap it in `StaleVersionError`; path-arm
 * writes propagate it to the File IPC adapter for domain-error mapping.
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
 * Best-effort unlink of an `atomicWriteFile` tmp file after a failure between
 * open and rename. Mirrors `move()`'s post-failure cleanup contract: ENOENT
 * is the desired post-state and stays silent; every other errno surfaces a
 * warn so oncall can find the stranded `.tmp-{uuid}` after the abort.
 *
 * Caller still rethrows the *original* error — this helper only exists for
 * observability and never replaces or wraps the failure cause.
 */
async function bestEffortUnlinkTmp(tmp: string, target: string): Promise<void> {
  try {
    await unlink(tmp)
  } catch (unlinkErr) {
    const code = (unlinkErr as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logger.warn('atomicWriteFile: tmp cleanup failed; tmp file may remain on disk', {
        tmp,
        target,
        code,
        err: unlinkErr
      })
    }
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
 * best-effort unlinks the tmp file before rethrowing — non-ENOENT unlink
 * failures warn-log so the stranded `.tmp-{uuid}` is observable. orphanSweep
 * only collects UUID-named files in the entry tree, so a silent leak here
 * would persist indefinitely. The target file is never partially written —
 * callers either see the previous content or the new content.
 *
 * `options.mode` applies to the tmp file at open(2), so secret-bearing content
 * is never on disk under a looser mode; the rename carries the mode to the
 * target, replacing whatever mode a pre-existing target had.
 */
export async function atomicWriteFile(
  target: FilePath,
  data: string | Uint8Array,
  options?: { mode?: number; signal?: AbortSignal }
): Promise<void> {
  options?.signal?.throwIfAborted()
  const tmp = tmpNameFor(target)
  const tmpHandle = await fsOpen(tmp, 'wx', options?.mode)
  try {
    try {
      await tmpHandle.writeFile(data, options?.signal ? { signal: options.signal } : undefined)
      await tmpHandle.sync()
      options?.signal?.throwIfAborted()
    } catch (err) {
      await tmpHandle.close().catch(() => undefined)
      await bestEffortUnlinkTmp(tmp, target)
      throw err
    }
    await tmpHandle.close()
  } catch (err) {
    // tmpHandle.close() above can throw on its own; if it does, the tmp
    // file is still on disk and must be cleaned up here.
    await bestEffortUnlinkTmp(tmp, target)
    throw err
  }
  try {
    options?.signal?.throwIfAborted()
    await rename(tmp, target)
  } catch (err) {
    await bestEffortUnlinkTmp(tmp, target)
    throw err
  }
  await fsyncDirectoryOf(target)
}

export interface PublishFileNoClobberOptions {
  signal?: AbortSignal
  /** Called before and after copying. It must verify that `target` is still an allowed destination. */
  validateTarget?: () => Promise<void>
}

function sameFileIdentity(left: Pick<Stats, 'dev' | 'ino'>, right: Pick<Stats, 'dev' | 'ino'>): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function publishReservationName(staged: string): string {
  return `${staged}.publish-${randomUUID()}`
}

function shouldFallbackFromHardLink(error: unknown): boolean {
  return HARD_LINK_FALLBACK_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

async function assertPathIdentity(target: FilePath, expected: Pick<Stats, 'dev' | 'ino'>): Promise<void> {
  const current = await fsLstat(target)
  if (!current.isFile() || !sameFileIdentity(current, expected)) {
    throw new Error(`Target path changed while being published: ${target}`)
  }
}

async function bestEffortUnlinkOwnedPath(
  target: FilePath,
  expected: Pick<Stats, 'dev' | 'ino'>,
  operation: string
): Promise<void> {
  const parentPath = path.dirname(target)
  const leafName = path.basename(target)
  if (
    !leafName ||
    leafName === '.' ||
    leafName === '..' ||
    leafName.includes('\0') ||
    leafName.includes('/') ||
    leafName.includes('\\')
  ) {
    logger.warn(`${operation}: refusing unsafe cleanup leaf name`, { target })
    return
  }

  try {
    const parentStat = await fsStat(parentPath)
    if (!parentStat.isDirectory()) throw new Error(`Cleanup parent is not a directory: ${parentPath}`)

    // The child verifies its actual cwd inode before touching the relative leaf,
    // so replacing a parent path before or after spawn cannot redirect cleanup.
    await runUnlinkOwnedPathChild(parentPath, leafName, parentStat, expected)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    const stderr = String((error as { stderr?: string | Buffer }).stderr ?? '').slice(0, CLEANUP_CHILD_MAX_BUFFER_BYTES)
    logger.warn(`${operation}: cleanup refused or failed; leaving path untouched`, { target, code, stderr, error })
  }
}

async function copyFileHandles(source: FileHandle, destination: FileHandle, signal?: AbortSignal): Promise<void> {
  const buffer = Buffer.allocUnsafe(PUBLISH_COPY_CHUNK_BYTES)
  let position = 0

  for (;;) {
    signal?.throwIfAborted()
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position)
    if (bytesRead === 0) break

    let chunkOffset = 0
    while (chunkOffset < bytesRead) {
      signal?.throwIfAborted()
      const { bytesWritten } = await destination.write(
        buffer,
        chunkOffset,
        bytesRead - chunkOffset,
        position + chunkOffset
      )
      if (bytesWritten === 0) throw new Error('Published target stopped accepting data')
      chunkOffset += bytesWritten
    }
    position += bytesRead
  }

  signal?.throwIfAborted()
  await destination.sync()
  signal?.throwIfAborted()
}

/**
 * Publish a fully-written staging file at `target` without replacing anything.
 *
 * The target first receives a new empty inode. Callers may validate that reserved
 * path before any staged content is copied; subsequent writes use the stable file
 * handle, so swapping a parent directory cannot redirect the content. Filesystems
 * without hard-link support fall back to creating the target itself exclusively,
 * which makes that empty reservation visible until copying finishes. A successful
 * call consumes `staged`.
 */
export async function publishFileNoClobber(
  staged: FilePath,
  target: FilePath,
  options: PublishFileNoClobberOptions = {}
): Promise<void> {
  options.signal?.throwIfAborted()
  const stagedPathStat = await fsLstat(staged)
  if (!stagedPathStat.isFile()) throw new Error(`Staged path is not a regular file: ${staged}`)

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const stagedHandle = await fsOpen(staged, constants.O_RDONLY | noFollow)
  let reservationHandle: FileHandle | undefined
  let reservationPath: FilePath | undefined
  let reservationStat: Stats | undefined
  let destinationHandle: FileHandle | undefined
  let destinationStat: Stats | undefined
  let targetReserved = false
  let committed = false

  try {
    const openedStagedStat = await stagedHandle.stat()
    if (!openedStagedStat.isFile() || !sameFileIdentity(openedStagedStat, stagedPathStat)) {
      throw new Error(`Staged path changed while being opened: ${staged}`)
    }

    reservationPath = publishReservationName(staged) as FilePath
    reservationHandle = await fsOpen(reservationPath, 'wx+', stagedPathStat.mode & 0o777)
    reservationStat = await reservationHandle.stat()

    options.signal?.throwIfAborted()
    try {
      await link(reservationPath, target)
      targetReserved = true
      destinationHandle = reservationHandle
      destinationStat = reservationStat
    } catch (error) {
      if (!shouldFallbackFromHardLink(error)) throw error
      options.signal?.throwIfAborted()
      destinationHandle = await fsOpen(target, 'wx+', stagedPathStat.mode & 0o777)
      targetReserved = true
      destinationStat = await destinationHandle.stat()
    }

    await assertPathIdentity(target, destinationStat)
    await options.validateTarget?.()

    await copyFileHandles(stagedHandle, destinationHandle, options.signal)
    await assertPathIdentity(target, destinationStat)
    await options.validateTarget?.()
    options.signal?.throwIfAborted()

    await stagedHandle.close()
    options.signal?.throwIfAborted()
    await destinationHandle.close()
    if (destinationHandle === reservationHandle) reservationHandle = undefined
    destinationHandle = undefined
    committed = true
  } finally {
    if (!committed && destinationHandle) {
      try {
        await destinationHandle.truncate(0)
        await destinationHandle.sync()
      } catch (error) {
        logger.warn('publishFileNoClobber: failed to clear uncommitted target', {
          target,
          code: (error as NodeJS.ErrnoException).code,
          error
        })
      }
    }
    await destinationHandle?.close().catch(() => undefined)
    if (reservationHandle !== destinationHandle) await reservationHandle?.close().catch(() => undefined)
    await stagedHandle.close().catch(() => undefined)

    if (!committed && targetReserved && destinationStat) {
      await bestEffortUnlinkOwnedPath(target, destinationStat, 'publishFileNoClobber')
    }
    if (reservationPath && reservationStat) {
      await bestEffortUnlinkOwnedPath(reservationPath, reservationStat, 'publishFileNoClobber')
    }
  }

  await bestEffortUnlinkOwnedPath(staged, stagedPathStat, 'publishFileNoClobber')
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
        // Mirror the atomicWriteFile contract: tmp cleanup is best-effort
        // and warn-logs non-ENOENT errors so a stranded `.tmp-<uuid>` is
        // observable. A bare `.catch(() => undefined)` here would silently
        // leak the tmp blob under EACCES/EBUSY/EPERM until orphanSweep
        // collects it >5min later (or never, if persistent).
        await bestEffortUnlinkTmp(this.tmp, this.target)
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
      // Same rationale as _final: surface non-ENOENT cleanup failures so
      // operators can find the leaked tmp blob; never block destroy on
      // cleanup outcome.
      void bestEffortUnlinkTmp(this.tmp, this.target).finally(() => callback(err))
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
  } else if (ambiguousMtime) {
    // FAT32 / SMB / NFS report mtime at second precision. When both
    // observed and expected mtimes land exactly on a second boundary
    // AND size matches, the OCC compare can't distinguish "no change
    // since expected" from "a different edit happened within the same
    // second and produced a same-size payload". Without `expectedContentHash`
    // there is no remaining tiebreaker — we proceed with the write but
    // warn-log so a lost-edit breadcrumb exists. Callers in collaboration
    // contexts (multi-app, cloud-synced volumes) should pass
    // `expectedContentHash` to close this window.
    logger.warn(
      'atomicWriteIfUnchanged: second-precision mtime ambiguity without contentHash; possible same-second concurrent overwrite',
      { target }
    )
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

/**
 * Copy a file from source to destination atomically (tmp + rename on dest).
 *
 * When `signal` is provided, an abort interrupts the in-flight byte copy: `pipeline`
 * destroys the `AtomicWriteStream`, whose `_destroy` best-effort unlinks the tmp file
 * (leaving `dest` untouched) before the returned promise rejects with an `AbortError`.
 * Without it, a single hung read (cloud placeholder, disconnected volume) could block
 * forever — see the knowledge directory-import freeze this guards against.
 */
export async function copy(src: FilePath, dest: FilePath, signal?: AbortSignal): Promise<void> {
  // `pipeline` treats an explicit trailing `undefined` as a stream (and throws on
  // validation), so branch instead of forwarding `undefined` as its options arg.
  if (signal) {
    await pipeline(createReadStream(src), createAtomicWriteStream(dest), { signal })
  } else {
    await pipeline(createReadStream(src), createAtomicWriteStream(dest))
  }
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
