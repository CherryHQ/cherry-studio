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
  type FileHandle,
  lstat as fsLstat,
  mkdir as fsMkdirPromise,
  open as fsOpen,
  readFile,
  realpath as fsRealpath,
  rename,
  rm as fsRm,
  stat as fsStat,
  unlink
} from 'node:fs/promises'
import path from 'node:path'
import { addAbortSignal, Readable, Writable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import type { ContentHash } from '@shared/data/types/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import mime from 'mime'

import { createContentHasher } from './contentHash'

const logger = loggerService.withContext('utils/file/fs')

const notImplemented = (op: string): never => {
  throw new Error(`@main/utils/file/fs.${op}: not implemented (deferred to Phase 2)`)
}

/** Read file content as text with optional encoding detection. */
export async function read(
  path: AbsoluteFilePath,
  options?: { encoding?: 'text'; detectEncoding?: boolean }
): Promise<string>
export async function read(
  path: AbsoluteFilePath,
  options: { encoding: 'base64' }
): Promise<{ data: string; mime: string }>
export async function read(
  path: AbsoluteFilePath,
  options: { encoding: 'binary' }
): Promise<{ data: Uint8Array; mime: string }>
export async function read(
  path: AbsoluteFilePath,
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

/** Read at most `length` bytes starting at the absolute byte `offset`. */
export async function readChunk(
  path: AbsoluteFilePath,
  offset: number,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const fileHandle = await fsOpen(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    let totalBytesRead = 0
    while (totalBytesRead < length) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        totalBytesRead,
        length - totalBytesRead,
        offset + totalBytesRead
      )
      if (bytesRead === 0) break
      totalBytesRead += bytesRead
    }
    return totalBytesRead === buffer.byteLength ? buffer : buffer.slice(0, totalBytesRead)
  } finally {
    await fileHandle.close()
  }
}

/** Returns true iff the path exists and is readable by the current process. */
export async function exists(path: AbsoluteFilePath): Promise<boolean> {
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
export async function probeReadable(path: AbsoluteFilePath): Promise<PathReadability> {
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
export async function isSameFile(a: AbsoluteFilePath, b: AbsoluteFilePath): Promise<boolean> {
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
export async function write(target: AbsoluteFilePath, data: string | Uint8Array): Promise<void> {
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
    public readonly target: AbsoluteFilePath,
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
  target: AbsoluteFilePath,
  data: string | Uint8Array,
  options?: { mode?: number }
): Promise<void> {
  const prepared = await prepareAtomicWrite(target, data, options)
  await prepared.commit()
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
  /** True once the prepared tmp file has entered the DB + rename commit phase. */
  readonly commitStarted: boolean
  abort(): Promise<void>
}

export interface ReadableFileSnapshot {
  readonly dev: number
  readonly ino: number
  readonly modifiedAt: number
  readonly size: number
  createReadStream(bytes?: number): Readable
  close(): Promise<void>
}

/**
 * Open a link-aware, fixed-length snapshot of a regular file. The returned
 * stream reads through the already-open handle and never follows a later path
 * replacement.
 */
export async function openReadableFileSnapshot(target: AbsoluteFilePath): Promise<ReadableFileSnapshot> {
  const pathStat = await fsLstat(target)
  if (!pathStat.isFile()) throw new Error('Snapshot source is not a regular file')

  const handle: FileHandle = await fsOpen(target, 'r')
  try {
    const handleStat = await handle.stat()
    if (!handleStat.isFile() || pathStat.dev !== handleStat.dev || pathStat.ino !== handleStat.ino) {
      throw new Error('Snapshot source changed before it could be opened')
    }
    const size = handleStat.size
    return {
      dev: handleStat.dev,
      ino: handleStat.ino,
      modifiedAt: Math.floor(handleStat.mtimeMs),
      size,
      createReadStream: (bytes = size) => {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > size) {
          throw new RangeError('Snapshot read length is outside the opened file')
        }
        return bytes === 0
          ? Readable.from(Buffer.alloc(0))
          : handle.createReadStream({ start: 0, end: bytes - 1, autoClose: false })
      },
      close: () => handle.close()
    }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

export type PreparedAtomicWriteState = 'prepared' | 'committed' | 'aborted'

/**
 * A fully-written, closed tmp file that has not yet replaced its target.
 *
 * FileManager uses this pause point to mark bytes-derived DB metadata unknown
 * before the atomic rename. Generic path writers call {@link commit}
 * immediately and preserve their existing one-step API.
 */
export interface PreparedAtomicWrite {
  readonly target: AbsoluteFilePath
  readonly size: number
  readonly contentHash: ContentHash
  readonly state: PreparedAtomicWriteState
  commit(): Promise<PathVersion>
  abort(): Promise<void>
}

class PreparedAtomicWriteImpl implements PreparedAtomicWrite {
  private currentState: PreparedAtomicWriteState = 'prepared'
  private committedVersion: PathVersion | undefined
  private settlement: Promise<PathVersion | undefined> | undefined

  constructor(
    readonly target: AbsoluteFilePath,
    private readonly tmp: string,
    readonly size: number,
    readonly contentHash: ContentHash
  ) {}

  get state(): PreparedAtomicWriteState {
    return this.currentState
  }

  async commit(): Promise<PathVersion> {
    if (this.currentState === 'committed') {
      return this.committedVersion!
    }
    if (this.currentState === 'aborted') {
      throw new Error(`Prepared atomic write for ${this.target} was already aborted`)
    }
    if (this.settlement) {
      const version = await this.settlement
      if (version) return version
      throw new Error(`Prepared atomic write for ${this.target} was already aborted`)
    }

    this.settlement = this.commitOnce()
    return (await this.settlement)!
  }

  async abort(): Promise<void> {
    if (this.currentState !== 'prepared') return
    if (this.settlement) {
      await this.settlement.catch(() => undefined)
      return
    }
    this.settlement = this.abortOnce()
    await this.settlement
  }

  private async commitOnce(): Promise<PathVersion> {
    let version: PathVersion
    try {
      const fd = await fsOpen(this.tmp, 'r+')
      try {
        await fd.sync()
        const s = await fd.stat()
        version = { mtime: Math.floor(s.mtimeMs), size: s.size }
      } finally {
        await fd.close()
      }
      await rename(this.tmp, this.target)
    } catch (err) {
      await bestEffortUnlinkTmp(this.tmp, this.target)
      this.currentState = 'aborted'
      throw err
    }

    this.currentState = 'committed'
    this.committedVersion = version
    await fsyncDirectoryOf(this.target)
    return version
  }

  private async abortOnce(): Promise<undefined> {
    this.currentState = 'aborted'
    await bestEffortUnlinkTmp(this.tmp, this.target)
    return undefined
  }
}

/** Prepare an in-memory payload without replacing `target` yet. */
export async function prepareAtomicWrite(
  target: AbsoluteFilePath,
  data: string | Uint8Array,
  options?: { mode?: number }
): Promise<PreparedAtomicWrite> {
  const tmp = tmpNameFor(target)
  const tmpHandle = await fsOpen(tmp, 'w', options?.mode)
  const bytes = typeof data === 'string' ? Buffer.from(data) : data
  try {
    try {
      await tmpHandle.writeFile(bytes)
    } catch (err) {
      await tmpHandle.close().catch(() => undefined)
      await bestEffortUnlinkTmp(tmp, target)
      throw err
    }
    await tmpHandle.close()
  } catch (err) {
    await bestEffortUnlinkTmp(tmp, target)
    throw err
  }
  return new PreparedAtomicWriteImpl(target, tmp, bytes.byteLength, createContentHasherDigest(bytes))
}

function createContentHasherDigest(bytes: Uint8Array): ContentHash {
  const hasher = createContentHasher()
  hasher.update(bytes)
  return hasher.digest()
}

class AtomicWriteStreamImpl extends Writable implements AtomicWriteStream {
  private readonly target: string
  private readonly tmp: string
  private readonly underlying: ReturnType<typeof nodeCreateWriteStream>
  private readonly hasher = createContentHasher()
  private readonly onPrepared: (prepared: PreparedAtomicWrite) => Promise<void>
  private size = 0
  private aborted = false
  private finalized = false
  private enteredCommit = false

  constructor(target: AbsoluteFilePath, onPrepared: (prepared: PreparedAtomicWrite) => Promise<void>) {
    super()
    this.target = target
    this.tmp = tmpNameFor(target)
    this.onPrepared = onPrepared
    this.underlying = nodeCreateWriteStream(this.tmp)
    this.underlying.on('error', (err) => this.destroy(err))
  }

  get commitStarted(): boolean {
    return this.enteredCommit
  }

  override _write(chunk: unknown, encoding: BufferEncoding, callback: (err?: Error | null) => void): void {
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk, encoding)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array)
    this.hasher.update(bytes)
    this.size += bytes.byteLength
    this.underlying.write(bytes, callback)
  }

  override _final(callback: (err?: Error | null) => void): void {
    this.underlying.end(async () => {
      try {
        const prepared = new PreparedAtomicWriteImpl(
          AbsoluteFilePathSchema.parse(this.target),
          this.tmp,
          this.size,
          this.hasher.digest()
        )
        if (this.aborted) {
          await prepared.abort()
          callback()
          return
        }
        this.enteredCommit = true
        await this.onPrepared(prepared)
        this.finalized = true
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
    if (this.finalized) {
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
    if (this.aborted || this.finalized) return
    if (this.enteredCommit) {
      await finished(this).catch(() => undefined)
      return
    }
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
export function createAtomicWriteStream(target: AbsoluteFilePath): AtomicWriteStream {
  return createPreparedAtomicWriteStream(target, async (prepared) => {
    await prepared.commit()
  })
}

/**
 * Create a stream whose tmp file is handed to `onPrepared` after fsync.
 * The stream emits `finish` only after that callback resolves.
 */
export function createPreparedAtomicWriteStream(
  target: AbsoluteFilePath,
  onPrepared: (prepared: PreparedAtomicWrite) => Promise<void>
): AtomicWriteStream {
  return new AtomicWriteStreamImpl(target, onPrepared)
}

async function prepareAtomicCopyStream(
  src: AbsoluteFilePath,
  dest: AbsoluteFilePath,
  signal?: AbortSignal
): Promise<PreparedAtomicWrite> {
  let result: PreparedAtomicWrite | undefined
  const writer = createPreparedAtomicWriteStream(dest, async (prepared) => {
    result = prepared
  })
  if (signal) {
    await pipeline(createReadStream(src), writer, { signal })
  } else {
    await pipeline(createReadStream(src), writer)
  }
  if (!result) throw new Error(`Atomic copy to ${dest} finished without a prepared write`)
  return result
}

/** Copy `src` into a prepared tmp file without replacing `dest` yet. */
export async function prepareAtomicCopy(
  src: AbsoluteFilePath,
  dest: AbsoluteFilePath,
  signal?: AbortSignal
): Promise<PreparedAtomicWrite> {
  return prepareAtomicCopyStream(src, dest, signal)
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
  target: AbsoluteFilePath,
  data: string | Uint8Array,
  expected: PathVersion,
  expectedContentHash?: ContentHash
): Promise<PathVersion> {
  const prepared = await prepareAtomicWrite(target, data)
  try {
    // The payload may take arbitrarily long to materialize. Validate only
    // after it is durable and immediately before the atomic rename so an
    // edit that lands during preparation is not silently overwritten.
    await assertPathVersionUnchanged(target, expected, expectedContentHash)
    return await prepared.commit()
  } catch (error) {
    await prepared.abort()
    throw error
  }
}

/** Validate optimistic-concurrency state without mutating the target. */
export async function assertPathVersionUnchanged(
  target: AbsoluteFilePath,
  expected: PathVersion,
  expectedContentHash?: ContentHash
): Promise<void> {
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
}

/** Get file/directory stats. */
export async function stat(
  path: AbsoluteFilePath
): Promise<{ size: number; createdAt: number; modifiedAt: number; isDirectory: boolean }> {
  const s = await fsStat(path)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory()
  }
}

/** Get link-aware file/directory stats without following a symbolic link. */
export async function lstat(target: AbsoluteFilePath): Promise<{
  size: number
  createdAt: number
  modifiedAt: number
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}> {
  const s = await fsLstat(target)
  return {
    size: s.size,
    createdAt: Math.floor(s.birthtimeMs),
    modifiedAt: Math.floor(s.mtimeMs),
    isDirectory: s.isDirectory(),
    isFile: s.isFile(),
    isSymbolicLink: s.isSymbolicLink()
  }
}

/** Resolve an existing path to its physical filesystem location. */
export async function realpath(target: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  return AbsoluteFilePathSchema.parse(await fsRealpath(target))
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
export async function copy(src: AbsoluteFilePath, dest: AbsoluteFilePath, signal?: AbortSignal): Promise<void> {
  const prepared = await prepareAtomicCopyStream(src, dest, signal)
  await prepared.commit()
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
export async function move(src: AbsoluteFilePath, dest: AbsoluteFilePath): Promise<void> {
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
export async function remove(target: AbsoluteFilePath): Promise<void> {
  try {
    await unlink(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/** Remove a directory recursively. Idempotent on missing path. */
export async function removeDir(target: AbsoluteFilePath): Promise<void> {
  await fsRm(target, { recursive: true, force: true })
}

/** Create a single directory. Throws if it already exists. */
export async function mkdir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdirPromise(target)
}

/** Ensure a directory exists, creating any missing ancestors. Idempotent. */
export async function ensureDir(target: AbsoluteFilePath): Promise<void> {
  await fsMkdirPromise(target, { recursive: true })
}

/** Compress an image (sharp). Returns the output path. */
export async function compressImage(_input: AbsoluteFilePath | Uint8Array, _output: AbsoluteFilePath): Promise<void> {
  return notImplemented('compressImage')
}

/**
 * Download `url` to `dest`. Streams the response body into an atomic writer
 * (tmp + rename), so an interrupted download leaves no partially-written
 * dest file. Throws on non-2xx responses.
 */
export async function download(url: string, dest: AbsoluteFilePath): Promise<void> {
  const prepared = await prepareAtomicDownload(url, dest)
  await prepared.commit()
}

/** Download into a prepared tmp file without replacing `dest` yet. */
export async function prepareAtomicDownload(url: string, dest: AbsoluteFilePath): Promise<PreparedAtomicWrite> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download(${url}): HTTP ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error(`download(${url}): response has no body`)
  }
  let prepared: PreparedAtomicWrite | undefined
  const writer = createPreparedAtomicWriteStream(dest, async (result) => {
    prepared = result
  })
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
  if (!prepared) throw new Error(`download(${url}): stream finished without a prepared write`)
  return prepared
}

/**
 * Compute the tagged XXH3-64 content hash of a file without buffering it whole.
 */
export async function hash(path: AbsoluteFilePath, signal?: AbortSignal): Promise<ContentHash> {
  return (await hashWithSize(path, signal)).contentHash
}

/** Compute content hash and byte count from the same read stream. */
export async function hashWithSize(
  path: AbsoluteFilePath,
  signal?: AbortSignal
): Promise<{ contentHash: ContentHash; size: number }> {
  signal?.throwIfAborted()
  const hasher = createContentHasher()
  const stream = createReadStream(path)
  let size = 0
  if (signal) addAbortSignal(signal, stream)
  for await (const chunk of stream) {
    const bytes = chunk as Buffer
    hasher.update(bytes)
    size += bytes.byteLength
  }
  return { contentHash: hasher.digest(), size }
}
