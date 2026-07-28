import { createHash } from 'node:crypto'
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BACKUP_CEILINGS } from './ceilings'
import { type DirScanResult, type FsIdentity, fsIdentityOf, identitiesEqual, scanDirectoryUnit } from './dirScan'
import {
  BackupCancelledError,
  CeilingExceededError,
  DiskFullError,
  NonRegularSourceError,
  SourceDriftError
} from './errors'

/**
 * Source-drift-safe staging for the export producer (Phase 1b-i). A backup
 * archive must prove which byte-for-byte version of a source it captured, so
 * every source is verified for stability WHILE it is streamed to staging and
 * hashed. Any change — identity (`dev`/`ino`), size, `mtime`/`ctime`
 * nanoseconds, or a directory tree that gains/loses/mutates a file or
 * subdirectory — fails closed with a {@link SourceDriftError} and removes only
 * operation-owned staging. Metadata uses BIGINT stat (`mtimeNs`/`ctimeNs`) so a
 * same-size fast rewrite (coarse-ms mtime) or a metadata-only touch is caught.
 *
 * SECURITY (symlink race): a source path could be swapped for a symlink between
 * `lstat` and `open`. Two gates close this: (1) open with `O_NOFOLLOW` where the
 * platform provides it (POSIX) so opening a swapped-in symlink fails; (2) as the
 * universal gate, compare the initial `lstat` identity against the OPENED
 * handle's `fstat` — a replacement has a different inode and is rejected before
 * any bytes are read.
 *
 * RESIDUAL RACE (documented honestly): Node exposes no `openat`/`fstatat`, so
 * directory traversal cannot be made a single atomic handle walk. Between the
 * initial scan and each file copy this module re-verifies the root and every
 * recorded ancestor directory's identity (and that each is still a real
 * directory), and a final full rescan is the backstop — but a sufficiently fast
 * swap-and-restore of an intermediate directory that reproduces identical
 * `dev`/`ino`/`ctimeNs` on every probe is not provably excluded on a
 * `readdir`+`lstat` API. `dev`/`ino` uniqueness and `ctime` monotonicity make
 * this practically infeasible; it is not a claimed impossibility.
 *
 * These functions take concrete paths (the caller resolves roots via
 * `application.getPath`); they never touch the path registry themselves.
 */

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

export interface StagedFile {
  readonly hash: string
  readonly size: number
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError()
}

function mapEnospc(err: unknown): unknown {
  return (err as NodeJS.ErrnoException)?.code === 'ENOSPC' ? new DiskFullError() : err
}

/**
 * Test seams (no-op in production; same pattern as `publishSeams`/`diskProbe`).
 * `afterInitialLstat` runs after the initial `lstat` and BEFORE `open`, so a test
 * can swap the path to prove the symlink-race identity gate. `afterStagePreVerify`
 * runs after a file's bytes are staged and BEFORE its post-`fstat`, to prove drift.
 */
export const driftHooks = {
  async afterInitialLstat(sourcePath: string): Promise<void> {
    void sourcePath
  },
  async afterStagePreVerify(sourcePath: string): Promise<void> {
    void sourcePath
  }
}

/**
 * Stage one regular file to `stagingPath` while streaming through a SHA-256.
 * Creates the destination EXCLUSIVELY (`O_EXCL`, mode `0600`) — a pre-existing
 * `stagingPath` is never truncated — and removes it on failure ONLY if this call
 * created it. Rejects a symlink/special source (and the lstat↔open swap race),
 * enforces the shared per-entry byte ceiling BEFORE creating any staging output,
 * checks cancellation per chunk, and fails closed on pre/post `fstat` drift.
 */
export async function stageFileWithDriftCheck(args: {
  sourcePath: string
  stagingPath: string
  signal?: AbortSignal
  /** Per-entry uncompressed byte ceiling (defaults to the shared frozen ceiling; narrow it in tests). */
  maxEntryBytes?: number
}): Promise<StagedFile> {
  const { sourcePath, stagingPath, signal } = args
  const maxEntryBytes = args.maxEntryBytes ?? BACKUP_CEILINGS.maxEntryUncompressedBytes
  throwIfAborted(signal)

  const initialStat = await lstat(sourcePath, { bigint: true })
  if (initialStat.isSymbolicLink() || !initialStat.isFile()) throw new NonRegularSourceError(sourcePath)
  const initial: FsIdentity = fsIdentityOf(initialStat, 'file')

  // Per-entry ceiling BEFORE any staging output is created (no partial left behind).
  if (initial.size > BigInt(maxEntryBytes)) {
    throw new CeilingExceededError('entry-bytes', `${sourcePath} is ${initial.size} > ${maxEntryBytes}`)
  }

  await driftHooks.afterInitialLstat(sourcePath)

  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(sourcePath, fsConstants.O_RDONLY | O_NOFOLLOW)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOENT') {
      throw new SourceDriftError(sourcePath, 'source replaced by a symlink/removed between lstat and open')
    }
    throw err
  }

  let ownedStaging = false
  let dest: Awaited<ReturnType<typeof open>> | undefined
  try {
    const openedStat = await handle.stat({ bigint: true })
    // Universal identity gate: the opened fd MUST be the same inode we lstat'd.
    if (!openedStat.isFile() || !identitiesEqual(initial, fsIdentityOf(openedStat, 'file'))) {
      throw new SourceDriftError(sourcePath, 'source identity changed between lstat and open')
    }

    await mkdir(path.dirname(stagingPath), { recursive: true })
    // Exclusive create for OWNERSHIP: O_EXCL throws EEXIST on a pre-existing
    // (foreign) staging file BEFORE `ownedStaging` is set, so cleanup never
    // touches a file we did not create.
    dest = await open(stagingPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    ownedStaging = true

    const hash = createHash('sha256')
    let bytes = 0
    const source = createReadStream(sourcePath, { fd: handle.fd, autoClose: false })
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (signal?.aborted) {
          cb(new BackupCancelledError())
          return
        }
        bytes += chunk.length
        hash.update(chunk)
        cb(null, chunk)
      }
    })
    await pipeline(source, meter, createWriteStream(stagingPath, { fd: dest.fd, autoClose: false }))

    await driftHooks.afterStagePreVerify(sourcePath)

    const postStat = await handle.stat({ bigint: true })
    if (!identitiesEqual(initial, fsIdentityOf(postStat, 'file'))) {
      throw new SourceDriftError(sourcePath, 'file identity/size/mtime/ctime changed during staging')
    }
    if (BigInt(bytes) !== initial.size) {
      throw new SourceDriftError(sourcePath, `staged ${bytes} bytes but source size is ${initial.size}`)
    }
    return { hash: hash.digest('hex'), size: bytes }
  } catch (err) {
    if (ownedStaging) await rm(stagingPath, { force: true }).catch(() => {})
    throw mapEnospc(err)
  } finally {
    await dest?.close().catch(() => {})
    await handle.close().catch(() => {})
  }
}

export interface StagedDirectoryFile extends StagedFile {
  readonly relPath: string
}

function scansEqual(a: DirScanResult, b: DirScanResult): boolean {
  if (!identitiesEqual(a.rootId, b.rootId)) return false
  if (a.dirs.length !== b.dirs.length || a.entries.length !== b.entries.length) return false
  for (let i = 0; i < a.dirs.length; i++) {
    if (a.dirs[i].relPath !== b.dirs[i].relPath || !identitiesEqual(a.dirs[i].id, b.dirs[i].id)) return false
  }
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i].relPath !== b.entries[i].relPath || !identitiesEqual(a.entries[i].id, b.entries[i].id))
      return false
  }
  return true
}

/** POSIX ancestor relPaths of a file relPath, from the unit root ('') down to its parent. */
function ancestorRelPaths(fileRel: string): string[] {
  const segs = fileRel.split('/')
  segs.pop() // drop the file name
  const out = [''] // the unit root
  let prefix = ''
  for (const s of segs) {
    prefix = prefix ? `${prefix}/${s}` : s
    out.push(prefix)
  }
  return out
}

/**
 * Re-verify — just before copying a file — that the unit root and every recorded
 * ancestor directory still have their initial BIGINT identity and are still real
 * directories. Closes the gap that the source is copied file-by-file BETWEEN the
 * initial scan and the final rescan (a directory swapped mid-copy would otherwise
 * only be caught at the end, after some files were read through it).
 */
async function assertAncestorsUnchanged(
  sourceDir: string,
  fileRel: string,
  rootId: FsIdentity,
  dirById: ReadonlyMap<string, FsIdentity>
): Promise<void> {
  for (const anc of ancestorRelPaths(fileRel)) {
    const expected = anc === '' ? rootId : dirById.get(anc)
    if (!expected) throw new SourceDriftError(sourceDir, `ancestor '${anc}' vanished during staging`)
    const absAnc = anc === '' ? sourceDir : path.join(sourceDir, ...anc.split('/'))
    const st = await lstat(absAnc, { bigint: true })
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new SourceDriftError(absAnc, 'ancestor is no longer a real directory')
    }
    if (!identitiesEqual(expected, fsIdentityOf(st, 'dir'))) {
      throw new SourceDriftError(absAnc, 'ancestor directory identity changed during staging')
    }
  }
}

/**
 * Stage a directory unit to `stagingDir` with a defence-in-depth drift guard: a
 * deterministic initial scan (shared {@link scanDirectoryUnit} — symlink/special
 * rejected, portable-path + collision + ceiling rules, incremental cancellation);
 * per-file ancestor re-verification (root + every ancestor dir identity, real-dir
 * check) BEFORE each copy; per-file pre/post `fstat` verification; and a final
 * rescan that must equal the initial scan including EVERY file's and
 * subdirectory's bigint identity. `stagingDir` is created EXCLUSIVELY and removed
 * only when this call created it — a pre-existing directory is left untouched.
 */
export async function stageDirectoryWithDriftCheck(args: {
  sourceDir: string
  stagingDir: string
  signal?: AbortSignal
  excludeKnowledgeDerivedIndex?: boolean
}): Promise<{ files: readonly StagedDirectoryFile[] }> {
  const { sourceDir, stagingDir, signal, excludeKnowledgeDerivedIndex } = args
  throwIfAborted(signal)

  // Exclusive root creation: EEXIST ⇒ we do NOT own it ⇒ never remove it.
  try {
    await mkdir(stagingDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`stageDirectoryWithDriftCheck: staging dir already exists (ambiguous ownership): ${stagingDir}`)
    }
    throw err
  }

  try {
    const initial = await scanDirectoryUnit(sourceDir, { signal, excludeKnowledgeDerivedIndex })
    const dirById = new Map(initial.dirs.map((d) => [d.relPath, d.id]))
    // Directory entries are authoritative too: create them before copying files
    // so nested empty folders survive the archive round trip.
    for (const dir of initial.dirs) {
      throwIfAborted(signal)
      await mkdir(path.join(stagingDir, ...dir.relPath.split('/')), { recursive: true })
    }

    const files: StagedDirectoryFile[] = []
    for (const entry of initial.entries) {
      throwIfAborted(signal)
      await assertAncestorsUnchanged(sourceDir, entry.relPath, initial.rootId, dirById)
      const staged = await stageFileWithDriftCheck({
        sourcePath: path.join(sourceDir, ...entry.relPath.split('/')),
        stagingPath: path.join(stagingDir, ...entry.relPath.split('/')),
        signal
      })
      files.push({ relPath: entry.relPath, ...staged })
    }

    const final = await scanDirectoryUnit(sourceDir, { signal, excludeKnowledgeDerivedIndex })
    if (!scansEqual(initial, final)) {
      throw new SourceDriftError(sourceDir, 'directory tree changed during staging')
    }
    return { files }
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw mapEnospc(err)
  }
}
