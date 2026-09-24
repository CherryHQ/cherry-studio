import { type BigIntStats, constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

import { isSafeRelativeSubpath, portableCollisionKey } from '@main/utils/relativePath'

import { BACKUP_CEILINGS } from './ceilings'
import { BackupCancelledError, CeilingExceededError, NonRegularSourceError, UnportableSourceError } from './errors'

/**
 * The single, shared, safe scanner for a directory resource unit. Both
 * source-drift staging ({@link ./sourceDrift}) and canonical hashing
 * ({@link ./hashing}) walk a tree through here, so the producer's staged set and
 * the hashed/admitted set can never disagree on which files, in which order,
 * under which portability/ceiling rules.
 *
 * Guarantees while walking:
 * - the root is a real directory, never a symlink (`NonRegularSourceError`);
 * - strict mode (the default, used by hashing/admission) rejects every symlink
 *   and special node;
 * - capture mode (used only for live profile sources) materializes links whose
 *   final target remains inside the same unit and records every omitted
 *   external/dangling/cyclic/unclassified reference without following it into
 *   the archive;
 * - EVERY relative path — files AND directories — passes the Phase-1a
 *   portable-path rules (`isSafeRelativeSubpath`) and shares ONE case/NFC
 *   collision namespace (`portableCollisionKey`), so an empty directory with a
 *   reserved/overlong/colliding name cannot produce an inadmissible archive
 *   (`UnportableSourceError`);
 * - the shared ceilings apply incrementally: per-entry/total uncompressed bytes,
 *   path depth/length, and an ENTRY COUNT that includes directories as well as
 *   files (ZIP stores directory entries too) — see `entryCount`
 *   (`CeilingExceededError`);
 * - cancellation is checked incrementally per directory and per file.
 *
 * Identity uses BIGINT stat metadata (`dev`/`ino`/`size`/`mtimeNs`/`ctimeNs`
 * plus a file/dir kind tag), so a same-size fast rewrite (coarse-ms mtime) or a
 * metadata-only change is still observable to a re-scan.
 *
 * ENTRY ACCOUNTING: `entryCount` is this unit's directory + file entries. It
 * does NOT include the fixed archive entries (`manifest.json`, `backup.sqlite`)
 * or sibling units — summing units and reserving the fixed overhead against
 * `maxArchiveEntries` is the export orchestrator's (Phase 2) explicit job.
 */

/** BIGINT identity of a filesystem node, precise enough to detect same-size/metadata-only drift. */
export interface FsIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly kind: 'file' | 'dir' | 'symlink' | 'special'
}

export function fsIdentityOf(st: BigIntStats, kind: FsIdentity['kind']): FsIdentity {
  return { dev: st.dev, ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs, kind }
}

export function identitiesEqual(a: FsIdentity, b: FsIdentity): boolean {
  return (
    a.kind === b.kind &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  )
}

export interface DirScanEntry {
  /** POSIX relative path from the unit root. */
  readonly relPath: string
  /** POSIX path of the regular source bytes; differs when a link is materialized. */
  readonly sourceRelPath: string
  /** File byte size as a Number (files are ≤ 8 GiB < 2^53; used for hash framing). */
  readonly size: number
  /** Portable permission surface: execute for the owner or not; no other mode bits cross devices. */
  readonly executable: boolean
  readonly id: FsIdentity
}

/** Identity of a traversed directory, so a re-scan can prove no directory was swapped. */
export interface DirScanDir {
  readonly relPath: string
  /** POSIX path of the real source directory; differs when a link is materialized. */
  readonly sourceRelPath: string
  readonly id: FsIdentity
}

export const CAPTURE_OMISSION_REASONS = [
  'external-reference',
  'dangling-reference',
  'cyclic-reference',
  'unclassified-reference'
] as const
export type CaptureOmissionReason = (typeof CAPTURE_OMISSION_REASONS)[number]

export type CaptureNodeDecision =
  | { readonly kind: 'include' }
  | { readonly kind: 'materialize-internal' }
  | { readonly kind: 'exclude-derived' }
  | { readonly kind: 'omit-with-degradation'; readonly reason: CaptureOmissionReason }

export interface CaptureNodeContext {
  readonly relativePath: string
  readonly nodeKind: FsIdentity['kind']
  /** Internal final target or external lexical candidate. Never persisted in the manifest. */
  readonly resolvedTargetPath?: string
  readonly resolvedTargetKind?: Exclude<FsIdentity['kind'], 'symlink'>
  readonly defaultDecision: CaptureNodeDecision
}

/**
 * Owner policy can narrow generic capture semantics, chiefly to identify
 * rebuildable projections. It never performs traversal and it cannot make an
 * external link eligible for materialization.
 */
export interface CapturePolicy {
  readonly excludeRelativePath?: (relativePath: string) => boolean
  readonly decideNode?: (context: CaptureNodeContext) => CaptureNodeDecision | Promise<CaptureNodeDecision>
}

export interface DirScanLink {
  readonly relPath: string
  readonly sourceRelPath: string
  readonly id: FsIdentity
  readonly linkTarget: string
  /** Canonical target relative to the unit root; never external. */
  readonly targetRelPath: string
}

export interface DirScanOmission {
  readonly relPath: string
  readonly sourceRelPath: string
  readonly reason: CaptureOmissionReason
  /** Missing only when lstat itself was denied. */
  readonly id?: FsIdentity
  /** Used only to prove the link itself did not change; never an external resolved path. */
  readonly linkTarget?: string
}

export interface DirScanLimits {
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
  readonly maxPathDepth: number
  readonly maxPathLength: number
}

export const DEFAULT_DIR_SCAN_LIMITS: DirScanLimits = Object.freeze({
  maxEntries: BACKUP_CEILINGS.maxArchiveEntries,
  maxEntryBytes: BACKUP_CEILINGS.maxEntryUncompressedBytes,
  maxTotalBytes: BACKUP_CEILINGS.maxTotalUncompressedBytes,
  maxPathDepth: BACKUP_CEILINGS.maxPathDepth,
  maxPathLength: BACKUP_CEILINGS.maxPathLength
})

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

export interface DirScanOptions {
  readonly signal?: AbortSignal
  /** Strict is the archive trust boundary; capture is only for live profile sources. */
  readonly mode?: 'strict' | 'capture'
  readonly capturePolicy?: CapturePolicy
  readonly limits?: DirScanLimits
}

export interface DirScanResult {
  readonly entries: readonly DirScanEntry[]
  readonly dirs: readonly DirScanDir[]
  readonly links: readonly DirScanLink[]
  readonly omissions: readonly DirScanOmission[]
  readonly rootId: FsIdentity
  /** Directory + file entries in THIS unit (excludes fixed archive entries). */
  readonly entryCount: number
  /** Total uncompressed bytes of the regular files in this unit (bigint — may exceed 2^53). */
  readonly totalBytes: bigint
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError()
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

function joinPosix(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function permissionDenied(error: unknown): boolean {
  return ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
}

function kindOf(st: BigIntStats): FsIdentity['kind'] {
  if (st.isFile()) return 'file'
  if (st.isDirectory()) return 'dir'
  if (st.isSymbolicLink()) return 'symlink'
  return 'special'
}

type LinkResolution =
  | { readonly kind: 'internal'; readonly targetPath: string; readonly targetStat: BigIntStats }
  | { readonly kind: CaptureOmissionReason }

/**
 * Resolve a lexically internal link one component at a time. `realpath()` is
 * deliberately not used here: an internal-looking path can contain an
 * intermediate link that escapes the unit and later points back in. Following
 * that chain wholesale would cross the ownership boundary before its final
 * result could be classified.
 */
async function resolveInternalLink(
  canonicalRoot: string,
  linkPath: string,
  linkTarget: string,
  maxLinkHops: number
): Promise<LinkResolution> {
  const initialTarget = path.resolve(path.dirname(linkPath), linkTarget)
  if (!isInsideOrEqual(canonicalRoot, initialTarget)) return { kind: 'external-reference' }

  let pending = path.relative(canonicalRoot, initialTarget).split(path.sep).filter(Boolean)
  let current = canonicalRoot
  let finalStat: BigIntStats | undefined
  const seenLinks = new Set<string>()

  while (pending.length > 0) {
    const segment = pending.shift()!
    const candidate = path.join(current, segment)
    let st: BigIntStats
    try {
      st = await lstat(candidate, { bigint: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'dangling-reference' }
      if (code === 'ELOOP') return { kind: 'cyclic-reference' }
      if (permissionDenied(error)) return { kind: 'unclassified-reference' }
      throw error
    }

    if (st.isSymbolicLink()) {
      if (seenLinks.has(candidate)) return { kind: 'cyclic-reference' }
      seenLinks.add(candidate)
      if (seenLinks.size > maxLinkHops) return { kind: 'unclassified-reference' }

      let nestedTarget: string
      try {
        nestedTarget = await readlink(candidate)
      } catch (error) {
        if (permissionDenied(error) || (error as NodeJS.ErrnoException).code === 'EINVAL') {
          return { kind: 'unclassified-reference' }
        }
        throw error
      }
      const resolved = path.resolve(path.dirname(candidate), nestedTarget)
      if (!isInsideOrEqual(canonicalRoot, resolved)) return { kind: 'external-reference' }
      pending = [...path.relative(canonicalRoot, resolved).split(path.sep).filter(Boolean), ...pending]
      current = canonicalRoot
      finalStat = undefined
      continue
    }

    if (pending.length > 0 && !st.isDirectory()) return { kind: 'dangling-reference' }
    current = candidate
    finalStat = st
  }

  if (!finalStat) {
    try {
      finalStat = await lstat(current, { bigint: true })
    } catch (error) {
      if (permissionDenied(error)) return { kind: 'unclassified-reference' }
      throw error
    }
  }
  return { kind: 'internal', targetPath: current, targetStat: finalStat }
}

async function isReadableFile(filePath: string, expected: BigIntStats): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | O_NOFOLLOW)
  } catch (error) {
    if (permissionDenied(error)) return false
    throw error
  }
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !identitiesEqual(fsIdentityOf(expected, 'file'), fsIdentityOf(opened, 'file'))) {
      throw new NonRegularSourceError(filePath)
    }
    return true
  } finally {
    await handle.close()
  }
}

export async function scanDirectoryUnit(rootDir: string, options: DirScanOptions = {}): Promise<DirScanResult> {
  const { signal, capturePolicy } = options
  const captureMode = options.mode === 'capture'
  const limits = options.limits ?? DEFAULT_DIR_SCAN_LIMITS

  throwIfAborted(signal)
  const rootStat = await lstat(rootDir, { bigint: true })
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new NonRegularSourceError(rootDir)
  const canonicalRoot = await realpath(rootDir)

  const entries: DirScanEntry[] = []
  const dirs: DirScanDir[] = []
  const links: DirScanLink[] = []
  const omissions: DirScanOmission[] = []
  const collisionKeys = new Set<string>()
  const activeDirectories = new Set<string>()
  let totalBytes = 0n
  let entryCount = 0
  let observedNodeCount = 0

  const validatePath = (rel: string): void => {
    if (!isSafeRelativeSubpath(rel, { maxLength: limits.maxPathLength, maxDepth: limits.maxPathDepth })) {
      throw new UnportableSourceError(rel, 'invalid-path', rootDir)
    }
    const key = portableCollisionKey(rel)
    if (collisionKeys.has(key)) {
      throw new UnportableSourceError(rel, 'name-collision', rootDir)
    }
    collisionKeys.add(key)
  }

  const countOne = (rel: string): void => {
    entryCount++
    if (entryCount > limits.maxEntries) throw new CeilingExceededError('entry-count', `${rel}: > ${limits.maxEntries}`)
  }

  const observeOne = (rel: string): void => {
    observedNodeCount++
    if (observedNodeCount > limits.maxEntries) {
      throw new CeilingExceededError('entry-count', `${rel}: observed > ${limits.maxEntries}`)
    }
  }

  const ownerDecision = async (
    relativePath: string,
    nodeKind: FsIdentity['kind'],
    defaultDecision: CaptureNodeDecision,
    resolvedTargetPath?: string,
    resolvedTargetKind?: Exclude<FsIdentity['kind'], 'symlink'>
  ): Promise<CaptureNodeDecision> => {
    if (capturePolicy?.excludeRelativePath?.(relativePath)) {
      return { kind: 'exclude-derived' }
    }
    const decision = await capturePolicy?.decideNode?.({
      relativePath,
      nodeKind,
      ...(resolvedTargetPath ? { resolvedTargetPath } : {}),
      ...(resolvedTargetKind ? { resolvedTargetKind } : {}),
      defaultDecision
    })
    if (!decision) return defaultDecision
    if (decision.kind === 'materialize-internal' && defaultDecision.kind !== 'materialize-internal') {
      return defaultDecision
    }
    if (decision.kind === 'include' && nodeKind === 'symlink') return defaultDecision
    return decision
  }

  const recordOmission = (
    relPath: string,
    sourceRelPath: string,
    reason: CaptureOmissionReason,
    st?: BigIntStats,
    linkTarget?: string
  ): void => {
    omissions.push({
      relPath,
      sourceRelPath,
      reason,
      ...(st ? { id: fsIdentityOf(st, kindOf(st)) } : {}),
      ...(linkTarget !== undefined ? { linkTarget } : {})
    })
  }

  const walk = async (
    dir: string,
    outputParent: string,
    sourceParent: string,
    dirStat: BigIntStats
  ): Promise<{ hasIncludedNode: boolean; hadNode: boolean; hasOmittedNode: boolean }> => {
    throwIfAborted(signal)
    const directoryKey = `${dirStat.dev}:${dirStat.ino}`
    activeDirectories.add(directoryKey)
    let hasIncludedNode = false
    let hadNode = false
    let hasOmittedNode = false
    try {
      const names = await readdir(dir)
      for (const name of names) {
        throwIfAborted(signal)
        hadNode = true
        const abs = path.join(dir, name)
        const rel = joinPosix(outputParent, name)
        const sourceRel = joinPosix(sourceParent, name)
        observeOne(rel)
        let st: BigIntStats
        try {
          st = await lstat(abs, { bigint: true })
        } catch (error) {
          if (!captureMode || !permissionDenied(error)) throw error
          recordOmission(rel, sourceRel, 'unclassified-reference')
          hasOmittedNode = true
          continue
        }

        const nodeKind = kindOf(st)
        if (nodeKind === 'symlink') {
          if (!captureMode) {
            const decision = await ownerDecision(rel, nodeKind, { kind: 'include' })
            if (decision.kind === 'exclude-derived') continue
            throw new NonRegularSourceError(abs)
          }

          let linkTarget: string
          try {
            linkTarget = await readlink(abs)
          } catch {
            const decision = await ownerDecision(rel, nodeKind, {
              kind: 'omit-with-degradation',
              reason: 'unclassified-reference'
            })
            if (decision.kind === 'exclude-derived') continue
            recordOmission(rel, sourceRel, 'unclassified-reference', st)
            hasOmittedNode = true
            continue
          }

          const lexicalTargetPath = path.resolve(path.dirname(abs), linkTarget)
          if (!isInsideOrEqual(canonicalRoot, lexicalTargetPath)) {
            const decision = await ownerDecision(
              rel,
              nodeKind,
              { kind: 'omit-with-degradation', reason: 'external-reference' },
              lexicalTargetPath
            )
            if (decision.kind === 'exclude-derived') continue
            recordOmission(
              rel,
              sourceRel,
              decision.kind === 'omit-with-degradation' ? decision.reason : 'external-reference',
              st,
              linkTarget
            )
            hasOmittedNode = true
            continue
          }

          const resolution = await resolveInternalLink(canonicalRoot, abs, linkTarget, limits.maxPathDepth)
          if (resolution.kind !== 'internal') {
            const decision = await ownerDecision(rel, nodeKind, {
              kind: 'omit-with-degradation',
              reason: resolution.kind
            })
            if (decision.kind === 'exclude-derived') continue
            recordOmission(
              rel,
              sourceRel,
              decision.kind === 'omit-with-degradation' ? decision.reason : resolution.kind,
              st,
              linkTarget
            )
            hasOmittedNode = true
            continue
          }
          const { targetPath, targetStat } = resolution
          const targetKind = kindOf(targetStat)
          const resolvedTargetKind = targetKind === 'symlink' ? 'special' : targetKind
          const defaultDecision: CaptureNodeDecision =
            resolvedTargetKind === 'file' || resolvedTargetKind === 'dir'
              ? { kind: 'materialize-internal' }
              : {
                  kind: 'omit-with-degradation',
                  reason: 'unclassified-reference'
                }
          const decision = await ownerDecision(rel, nodeKind, defaultDecision, targetPath, resolvedTargetKind)
          if (decision.kind === 'exclude-derived') continue
          if (decision.kind !== 'materialize-internal') {
            recordOmission(
              rel,
              sourceRel,
              decision.kind === 'omit-with-degradation' ? decision.reason : 'unclassified-reference',
              st,
              linkTarget
            )
            hasOmittedNode = true
            continue
          }

          const targetRel = toPosixRel(canonicalRoot, targetPath)
          if (capturePolicy?.excludeRelativePath?.(targetRel)) continue
          if (resolvedTargetKind === 'dir') {
            const targetKey = `${targetStat.dev}:${targetStat.ino}`
            if (activeDirectories.has(targetKey)) {
              recordOmission(rel, sourceRel, 'cyclic-reference', st, linkTarget)
              hasOmittedNode = true
              continue
            }
            const child = await walk(targetPath, rel, targetRel, targetStat)
            if (!child.hasIncludedNode && child.hadNode && !child.hasOmittedNode) continue
            validatePath(rel)
            countOne(rel)
            dirs.push({ relPath: rel, sourceRelPath: targetRel, id: fsIdentityOf(targetStat, 'dir') })
            links.push({
              relPath: rel,
              sourceRelPath: sourceRel,
              id: fsIdentityOf(st, 'symlink'),
              linkTarget,
              targetRelPath: targetRel
            })
            hasIncludedNode = true
            if (child.hasOmittedNode) hasOmittedNode = true
            continue
          }

          if (!(await isReadableFile(targetPath, targetStat))) {
            recordOmission(rel, sourceRel, 'unclassified-reference', st, linkTarget)
            hasOmittedNode = true
            continue
          }
          validatePath(rel)
          const size = targetStat.size
          if (size > BigInt(limits.maxEntryBytes)) {
            throw new CeilingExceededError('entry-bytes', `${rel} is ${size} > ${limits.maxEntryBytes}`)
          }
          totalBytes += size
          if (totalBytes > BigInt(limits.maxTotalBytes)) {
            throw new CeilingExceededError('total-bytes', `> ${limits.maxTotalBytes}`)
          }
          countOne(rel)
          entries.push({
            relPath: rel,
            sourceRelPath: targetRel,
            size: Number(size),
            executable: (targetStat.mode & 0o111n) !== 0n,
            id: fsIdentityOf(targetStat, 'file')
          })
          links.push({
            relPath: rel,
            sourceRelPath: sourceRel,
            id: fsIdentityOf(st, 'symlink'),
            linkTarget,
            targetRelPath: targetRel
          })
          hasIncludedNode = true
          continue
        }

        const defaultDecision: CaptureNodeDecision =
          nodeKind === 'special'
            ? { kind: 'omit-with-degradation', reason: 'unclassified-reference' }
            : { kind: 'include' }
        const decision = await ownerDecision(rel, nodeKind, defaultDecision)
        if (decision.kind === 'exclude-derived') continue
        if (decision.kind === 'omit-with-degradation') {
          if (!captureMode) throw new NonRegularSourceError(abs)
          recordOmission(rel, sourceRel, decision.reason, st)
          hasOmittedNode = true
          continue
        }
        if (nodeKind === 'special') throw new NonRegularSourceError(abs)

        if (nodeKind === 'dir') {
          let child: Awaited<ReturnType<typeof walk>>
          try {
            child = await walk(abs, rel, sourceRel, st)
          } catch (error) {
            if (!captureMode || !permissionDenied(error)) throw error
            recordOmission(rel, sourceRel, 'unclassified-reference', st)
            hasOmittedNode = true
            continue
          }
          // Preserve a genuinely empty or partially omitted authoritative
          // directory. Omit only a shell whose children are all owner-derived.
          if (!child.hasIncludedNode && child.hadNode && !child.hasOmittedNode) continue
          validatePath(rel)
          countOne(rel)
          dirs.push({ relPath: rel, sourceRelPath: sourceRel, id: fsIdentityOf(st, 'dir') })
          hasIncludedNode = true
          if (child.hasOmittedNode) hasOmittedNode = true
          continue
        }

        if (captureMode && !(await isReadableFile(abs, st))) {
          recordOmission(rel, sourceRel, 'unclassified-reference', st)
          hasOmittedNode = true
          continue
        }
        validatePath(rel)
        const size = st.size
        if (size > BigInt(limits.maxEntryBytes)) {
          throw new CeilingExceededError('entry-bytes', `${rel} is ${size} > ${limits.maxEntryBytes}`)
        }
        totalBytes += size
        if (totalBytes > BigInt(limits.maxTotalBytes)) {
          throw new CeilingExceededError('total-bytes', `> ${limits.maxTotalBytes}`)
        }
        countOne(rel)
        entries.push({
          relPath: rel,
          sourceRelPath: sourceRel,
          size: Number(size),
          executable: (st.mode & 0o111n) !== 0n,
          id: fsIdentityOf(st, 'file')
        })
        hasIncludedNode = true
      }
      return { hasIncludedNode, hadNode, hasOmittedNode }
    } finally {
      activeDirectories.delete(directoryKey)
    }
  }

  await walk(canonicalRoot, '', '', rootStat)
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  dirs.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  links.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  omissions.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  return {
    entries,
    dirs,
    links,
    omissions,
    rootId: fsIdentityOf(rootStat, 'dir'),
    entryCount,
    totalBytes
  }
}
