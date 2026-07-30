import { createHash } from 'node:crypto'
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, readlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BACKUP_CEILINGS } from './ceilings'
import {
  type CapturePolicy,
  type DirScanResult,
  type FsIdentity,
  fsIdentityOf,
  identitiesEqual,
  scanDirectoryUnit
} from './dirScan'
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
  /** The only transported POSIX mode fact; restoration maps it to 0700/0600. */
  readonly executable: boolean
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
 * `beforeAncestorVerify` runs before the next directory ancestor identity walk.
 */
export const driftHooks = {
  async afterInitialLstat(sourcePath: string): Promise<void> {
    void sourcePath
  },
  async afterStagePreVerify(sourcePath: string): Promise<void> {
    void sourcePath
  },
  async beforeAncestorVerify(sourceDir: string, fileRel: string): Promise<void> {
    void sourceDir
    void fileRel
  },
  async afterAncestorVerify(sourceDir: string, fileRel: string): Promise<void> {
    void sourceDir
    void fileRel
  }
}

/**
 * Stage one regular file to `stagingPath` while streaming through a SHA-256.
 * Creates the destination EXCLUSIVELY (`O_EXCL`, safe mode `0600`/`0700`) — a pre-existing
 * `stagingPath` is never truncated — and removes it on failure ONLY if this call
 * created it. Rejects a symlink/special source (and the lstat↔open swap race),
 * enforces the shared per-entry byte ceiling BEFORE creating any staging output,
 * checks cancellation per chunk, and fails closed on pre/post `fstat` drift.
 */
export async function stageFileWithDriftCheck(args: {
  sourcePath: string
  stagingPath: string
  /** Identity captured at the database snapshot boundary, when available. */
  expectedIdentity?: FsIdentity
  signal?: AbortSignal
  /** Per-entry uncompressed byte ceiling (defaults to the shared frozen ceiling; narrow it in tests). */
  maxEntryBytes?: number
}): Promise<StagedFile> {
  const { sourcePath, stagingPath, signal } = args
  const maxEntryBytes = args.maxEntryBytes ?? BACKUP_CEILINGS.maxEntryUncompressedBytes
  throwIfAborted(signal)

  let initialStat: Awaited<ReturnType<typeof lstat>>
  try {
    initialStat = await lstat(sourcePath, { bigint: true })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new SourceDriftError(sourcePath, 'source disappeared after the database snapshot boundary')
    }
    throw error
  }
  if (initialStat.isSymbolicLink() || !initialStat.isFile()) throw new NonRegularSourceError(sourcePath)
  const initial: FsIdentity = fsIdentityOf(initialStat, 'file')
  if (args.expectedIdentity && !identitiesEqual(args.expectedIdentity, initial)) {
    throw new SourceDriftError(sourcePath, 'file changed since the database snapshot boundary')
  }

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

    await mkdir(path.dirname(stagingPath), { recursive: true, mode: 0o700 })
    // Exclusive create for OWNERSHIP: O_EXCL throws EEXIST on a pre-existing
    // (foreign) staging file BEFORE `ownedStaging` is set, so cleanup never
    // touches a file we did not create.
    const executable = (initialStat.mode & 0o111n) !== 0n
    dest = await open(
      stagingPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      executable ? 0o700 : 0o600
    )
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
    return { hash: hash.digest('hex'), size: bytes, executable }
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

export interface PartialTreeOmission {
  readonly relPath: string
  readonly reason:
    | 'changed-during-capture'
    | 'external-reference'
    | 'dangling-reference'
    | 'cyclic-reference'
    | 'unclassified-reference'
}

export function scansEqual(a: DirScanResult, b: DirScanResult): boolean {
  if (!identitiesEqual(a.rootId, b.rootId)) return false
  if (a.entryCount !== b.entryCount || a.totalBytes !== b.totalBytes) return false
  if (
    a.dirs.length !== b.dirs.length ||
    a.entries.length !== b.entries.length ||
    a.links.length !== b.links.length ||
    a.omissions.length !== b.omissions.length
  )
    return false
  for (let i = 0; i < a.dirs.length; i++) {
    if (
      a.dirs[i].relPath !== b.dirs[i].relPath ||
      a.dirs[i].sourceRelPath !== b.dirs[i].sourceRelPath ||
      !identitiesEqual(a.dirs[i].id, b.dirs[i].id)
    )
      return false
  }
  for (let i = 0; i < a.entries.length; i++) {
    if (
      a.entries[i].relPath !== b.entries[i].relPath ||
      a.entries[i].sourceRelPath !== b.entries[i].sourceRelPath ||
      a.entries[i].size !== b.entries[i].size ||
      a.entries[i].executable !== b.entries[i].executable ||
      !identitiesEqual(a.entries[i].id, b.entries[i].id)
    )
      return false
  }
  for (let i = 0; i < a.links.length; i++) {
    if (
      a.links[i].relPath !== b.links[i].relPath ||
      a.links[i].sourceRelPath !== b.links[i].sourceRelPath ||
      a.links[i].linkTarget !== b.links[i].linkTarget ||
      a.links[i].targetRelPath !== b.links[i].targetRelPath ||
      !identitiesEqual(a.links[i].id, b.links[i].id)
    )
      return false
  }
  for (let i = 0; i < a.omissions.length; i++) {
    const left = a.omissions[i]
    const right = b.omissions[i]
    if (
      left.relPath !== right.relPath ||
      left.sourceRelPath !== right.sourceRelPath ||
      left.reason !== right.reason ||
      left.linkTarget !== right.linkTarget ||
      (left.id === undefined) !== (right.id === undefined) ||
      (left.id !== undefined && right.id !== undefined && !identitiesEqual(left.id, right.id))
    )
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
  sourceRelPath: string,
  rootId: FsIdentity,
  dirById: ReadonlyMap<string, FsIdentity>,
  identityMatches: (expected: FsIdentity, actual: FsIdentity) => boolean = identitiesEqual
): Promise<void> {
  await driftHooks.beforeAncestorVerify(sourceDir, sourceRelPath)
  for (const anc of ancestorRelPaths(sourceRelPath)) {
    const expected = anc === '' ? rootId : dirById.get(anc)
    if (!expected) throw new SourceDriftError(sourceDir, `ancestor '${anc}' vanished during staging`)
    const absAnc = anc === '' ? sourceDir : path.join(sourceDir, ...anc.split('/'))
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(absAnc, { bigint: true })
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new SourceDriftError(absAnc, 'ancestor disappeared during staging')
      }
      throw error
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new SourceDriftError(absAnc, 'ancestor is no longer a real directory')
    }
    if (!identityMatches(expected, fsIdentityOf(st, 'dir'))) {
      throw new SourceDriftError(absAnc, 'ancestor directory identity changed during staging')
    }
  }
}

async function assertReferenceProofsUnchanged(sourceDir: string, scan: DirScanResult): Promise<void> {
  for (const reference of [...scan.links, ...scan.omissions]) {
    if (!reference.id) continue
    const sourcePath = path.join(sourceDir, ...reference.sourceRelPath.split('/'))
    let st: Awaited<ReturnType<typeof lstat>>
    try {
      st = await lstat(sourcePath, { bigint: true })
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new SourceDriftError(sourcePath, 'captured reference disappeared during staging')
      }
      throw error
    }
    const kind: FsIdentity['kind'] = st.isSymbolicLink()
      ? 'symlink'
      : st.isFile()
        ? 'file'
        : st.isDirectory()
          ? 'dir'
          : 'special'
    if (!identitiesEqual(reference.id, fsIdentityOf(st, kind))) {
      throw new SourceDriftError(sourcePath, 'captured reference identity changed during staging')
    }
    if (reference.id.kind === 'symlink') {
      let currentTarget: string
      try {
        currentTarget = await readlink(sourcePath)
      } catch {
        throw new SourceDriftError(sourcePath, 'captured link is no longer readable during staging')
      }
      if (currentTarget !== reference.linkTarget) {
        throw new SourceDriftError(sourcePath, 'captured link target changed during staging')
      }
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
  /** Tree identity captured at the database snapshot boundary, when available. */
  expectedScan?: DirScanResult
  signal?: AbortSignal
  capturePolicy?: CapturePolicy
}): Promise<{ files: readonly StagedDirectoryFile[]; scan: DirScanResult }> {
  const { sourceDir, stagingDir, signal, capturePolicy } = args
  throwIfAborted(signal)

  // Exclusive root creation: EEXIST ⇒ we do NOT own it ⇒ never remove it.
  try {
    await mkdir(stagingDir, { mode: 0o700 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`stageDirectoryWithDriftCheck: staging dir already exists (ambiguous ownership): ${stagingDir}`)
    }
    throw err
  }

  try {
    let initial: DirScanResult
    try {
      initial = await scanDirectoryUnit(sourceDir, {
        signal,
        capturePolicy,
        mode: capturePolicy ? 'capture' : 'strict'
      })
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new SourceDriftError(sourceDir, 'source disappeared after the database snapshot boundary')
      }
      throw error
    }
    if (args.expectedScan && !scansEqual(args.expectedScan, initial)) {
      throw new SourceDriftError(sourceDir, 'directory tree changed since the database snapshot boundary')
    }
    const dirById = new Map(initial.dirs.map((d) => [d.sourceRelPath, d.id]))
    await assertReferenceProofsUnchanged(sourceDir, initial)
    // Directory entries are authoritative too: create them before copying files
    // so nested empty folders survive the archive round trip.
    for (const dir of initial.dirs) {
      throwIfAborted(signal)
      await mkdir(path.join(stagingDir, ...dir.relPath.split('/')), { recursive: true, mode: 0o700 })
    }

    const files: StagedDirectoryFile[] = []
    for (const entry of initial.entries) {
      throwIfAborted(signal)
      await assertAncestorsUnchanged(sourceDir, entry.sourceRelPath, initial.rootId, dirById)
      await driftHooks.afterAncestorVerify(sourceDir, entry.relPath)
      const staged = await stageFileWithDriftCheck({
        sourcePath: path.join(sourceDir, ...entry.sourceRelPath.split('/')),
        stagingPath: path.join(stagingDir, ...entry.relPath.split('/')),
        expectedIdentity: entry.id,
        signal
      })
      files.push({ relPath: entry.relPath, ...staged })
    }

    let final: DirScanResult
    try {
      final = await scanDirectoryUnit(sourceDir, {
        signal,
        capturePolicy,
        mode: capturePolicy ? 'capture' : 'strict'
      })
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new SourceDriftError(sourceDir, 'source disappeared during staging')
      }
      throw error
    }
    if (!scansEqual(initial, final)) {
      throw new SourceDriftError(sourceDir, 'directory tree changed during staging')
    }
    return { files, scan: initial }
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw mapEnospc(err)
  }
}

function sameFilesystemNode(a: FsIdentity, b: FsIdentity): boolean {
  return a.kind === b.kind && a.dev === b.dev && a.ino === b.ino
}

function sameDirectoryEntry(
  left: DirScanResult['dirs'][number] | undefined,
  right: DirScanResult['dirs'][number] | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.relPath === right.relPath &&
      left.sourceRelPath === right.sourceRelPath &&
      sameFilesystemNode(left.id, right.id)
  )
}

function sameFileEntry(
  left: DirScanResult['entries'][number] | undefined,
  right: DirScanResult['entries'][number] | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.relPath === right.relPath &&
      left.sourceRelPath === right.sourceRelPath &&
      left.executable === right.executable &&
      identitiesEqual(left.id, right.id)
  )
}

function sameLinkEntry(
  left: DirScanResult['links'][number] | undefined,
  right: DirScanResult['links'][number] | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.relPath === right.relPath &&
      left.sourceRelPath === right.sourceRelPath &&
      left.linkTarget === right.linkTarget &&
      left.targetRelPath === right.targetRelPath &&
      identitiesEqual(left.id, right.id)
  )
}

function sameOmission(
  left: DirScanResult['omissions'][number] | undefined,
  right: DirScanResult['omissions'][number] | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.relPath === right.relPath &&
      left.sourceRelPath === right.sourceRelPath &&
      left.reason === right.reason &&
      left.linkTarget === right.linkTarget &&
      ((left.id === undefined && right.id === undefined) ||
        (left.id !== undefined && right.id !== undefined && identitiesEqual(left.id, right.id)))
  )
}

function pathIsAtOrBelow(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`)
}

function stableLinkChain(
  relPath: string,
  firstLinks: ReadonlyMap<string, DirScanResult['links'][number]>,
  secondLinks: ReadonlyMap<string, DirScanResult['links'][number]>
): boolean {
  for (const [linkPath, first] of firstLinks) {
    if (pathIsAtOrBelow(relPath, linkPath) && !sameLinkEntry(first, secondLinks.get(linkPath))) return false
  }
  for (const linkPath of secondLinks.keys()) {
    if (pathIsAtOrBelow(relPath, linkPath) && !firstLinks.has(linkPath)) return false
  }
  return true
}

function addPartialOmission(
  omissions: Map<string, PartialTreeOmission['reason']>,
  relPath: string,
  reason: PartialTreeOmission['reason']
): void {
  const current = omissions.get(relPath)
  if (current === undefined || reason === 'changed-during-capture') omissions.set(relPath, reason)
}

/**
 * Capture a useful cut of a directory whose unrelated entries may keep
 * changing. Two owner-scoped scans define the candidate set. Only files whose
 * identity, materialized-link chain, and ancestor inode chain agree in both
 * scans are copied; a file that changes during its own copy is omitted too.
 *
 * Unlike {@link stageDirectoryWithDriftCheck}, sibling creation/deletion does
 * not invalidate already-stable files. This is intentional for workspaces and
 * notes: each included file is a complete byte version, while changing entries
 * are disclosed individually as `changed-during-capture`.
 */
export async function stagePartialDirectoryTree(args: {
  sourceDir: string
  stagingDir: string
  signal?: AbortSignal
  capturePolicy?: CapturePolicy
}): Promise<{ files: readonly StagedDirectoryFile[]; omissions: readonly PartialTreeOmission[] }> {
  const { sourceDir, stagingDir, signal, capturePolicy } = args
  throwIfAborted(signal)

  try {
    await mkdir(stagingDir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`stagePartialDirectoryTree: staging dir already exists (ambiguous ownership): ${stagingDir}`)
    }
    throw error
  }

  try {
    const scan = async (): Promise<DirScanResult> =>
      scanDirectoryUnit(sourceDir, {
        signal,
        capturePolicy,
        mode: capturePolicy ? 'capture' : 'strict'
      })
    const first = await scan()
    const second = await scan()
    if (!sameFilesystemNode(first.rootId, second.rootId)) {
      throw new SourceDriftError(sourceDir, 'partial-tree root was replaced during capture')
    }

    const firstDirs = new Map(first.dirs.map((entry) => [entry.relPath, entry]))
    const secondDirs = new Map(second.dirs.map((entry) => [entry.relPath, entry]))
    const firstFiles = new Map(first.entries.map((entry) => [entry.relPath, entry]))
    const secondFiles = new Map(second.entries.map((entry) => [entry.relPath, entry]))
    const firstLinks = new Map(first.links.map((entry) => [entry.relPath, entry]))
    const secondLinks = new Map(second.links.map((entry) => [entry.relPath, entry]))
    const firstOmissions = new Map(first.omissions.map((entry) => [entry.relPath, entry]))
    const secondOmissions = new Map(second.omissions.map((entry) => [entry.relPath, entry]))
    const omissions = new Map<string, PartialTreeOmission['reason']>()

    for (const relPath of new Set([...firstOmissions.keys(), ...secondOmissions.keys()])) {
      const firstOmission = firstOmissions.get(relPath)
      const secondOmission = secondOmissions.get(relPath)
      addPartialOmission(
        omissions,
        relPath,
        sameOmission(firstOmission, secondOmission) ? secondOmission!.reason : 'changed-during-capture'
      )
    }

    const stableDirs = new Set<string>()
    for (const relPath of new Set([...firstDirs.keys(), ...secondDirs.keys()])) {
      const stable =
        sameDirectoryEntry(firstDirs.get(relPath), secondDirs.get(relPath)) &&
        stableLinkChain(relPath, firstLinks, secondLinks)
      if (stable) {
        stableDirs.add(relPath)
      } else {
        addPartialOmission(omissions, relPath, 'changed-during-capture')
      }
    }
    for (const relPath of [...stableDirs].sort((left, right) => left.split('/').length - right.split('/').length)) {
      const ancestors = ancestorRelPaths(`${relPath}/leaf`).filter(Boolean)
      if (ancestors.some((ancestor) => ancestor !== relPath && !stableDirs.has(ancestor))) {
        stableDirs.delete(relPath)
        addPartialOmission(omissions, relPath, 'changed-during-capture')
        continue
      }
      await mkdir(path.join(stagingDir, ...relPath.split('/')), { recursive: true, mode: 0o700 })
    }

    const secondDirBySourcePath = new Map(second.dirs.map((entry) => [entry.sourceRelPath, entry.id]))
    const files: StagedDirectoryFile[] = []
    for (const relPath of new Set([...firstFiles.keys(), ...secondFiles.keys()])) {
      throwIfAborted(signal)
      const entry = secondFiles.get(relPath)
      const stable = sameFileEntry(firstFiles.get(relPath), entry) && stableLinkChain(relPath, firstLinks, secondLinks)
      if (!stable || !entry) {
        addPartialOmission(omissions, relPath, 'changed-during-capture')
        continue
      }

      try {
        await assertAncestorsUnchanged(
          sourceDir,
          entry.sourceRelPath,
          second.rootId,
          secondDirBySourcePath,
          sameFilesystemNode
        )
        await driftHooks.afterAncestorVerify(sourceDir, entry.relPath)
        const staged = await stageFileWithDriftCheck({
          sourcePath: path.join(sourceDir, ...entry.sourceRelPath.split('/')),
          stagingPath: path.join(stagingDir, ...entry.relPath.split('/')),
          expectedIdentity: entry.id,
          signal
        })
        files.push({ relPath: entry.relPath, ...staged })
      } catch (error) {
        if (error instanceof BackupCancelledError || error instanceof DiskFullError) throw error
        if (
          error instanceof SourceDriftError ||
          error instanceof NonRegularSourceError ||
          ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
        ) {
          addPartialOmission(omissions, relPath, 'changed-during-capture')
          continue
        }
        throw error
      }
    }

    return {
      files,
      omissions: [...omissions]
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
        .map(([relPath, reason]) => ({ relPath, reason }))
    }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw mapEnospc(error)
  }
}
