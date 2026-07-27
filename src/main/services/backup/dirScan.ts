import type { BigIntStats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

import { isSafeRelativeSubpath, portableCollisionKey } from '@main/utils/relativePath'

import { isKnowledgeDerivedIndexPath } from './archiveLayout'
import { BACKUP_CEILINGS } from './ceilings'
import { BackupCancelledError, CeilingExceededError, NonRegularSourceError, UnportableSourceError } from './errors'

/**
 * The single, shared, safe scanner for a directory resource unit. Both
 * source-drift staging ({@link ./sourceDrift}) and canonical hashing
 * ({@link ./hashing}) walk a tree through here, so the producer's staged set and
 * the hashed/admitted set can never disagree on which files, in which order,
 * under which portability/ceiling rules.
 *
 * Guarantees while walking (all fail closed):
 * - the root is a real directory, never a symlink (`NonRegularSourceError`);
 * - every node is `lstat`-inspected; any symlink or special (non-regular) file
 *   is rejected — so no scan follows a link out of the unit;
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
  readonly kind: 'file' | 'dir'
}

export function fsIdentityOf(st: BigIntStats, kind: 'file' | 'dir'): FsIdentity {
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
  /** File byte size as a Number (files are ≤ 8 GiB < 2^53; used for hash framing). */
  readonly size: number
  readonly id: FsIdentity
}

/** Identity of a traversed directory, so a re-scan can prove no directory was swapped. */
export interface DirScanDir {
  readonly relPath: string
  readonly id: FsIdentity
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

export interface DirScanOptions {
  readonly signal?: AbortSignal
  /**
   * Opt-in to drop ONLY the Knowledge unit-root rebuildable index
   * `.cherry/index.sqlite{,-wal,-shm}` (docs §6.7). DEFAULT `false`. Named
   * specifically so no caller mistakes it for a generic exclusion policy — only
   * the Knowledge adapter passes it, and only the exact unit-root paths match.
   */
  readonly excludeKnowledgeDerivedIndex?: boolean
  readonly limits?: DirScanLimits
}

export interface DirScanResult {
  readonly entries: readonly DirScanEntry[]
  readonly dirs: readonly DirScanDir[]
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

export async function scanDirectoryUnit(rootDir: string, options: DirScanOptions = {}): Promise<DirScanResult> {
  const { signal, excludeKnowledgeDerivedIndex = false } = options
  const limits = options.limits ?? DEFAULT_DIR_SCAN_LIMITS

  throwIfAborted(signal)
  const rootStat = await lstat(rootDir, { bigint: true })
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new NonRegularSourceError(rootDir)

  const entries: DirScanEntry[] = []
  const dirs: DirScanDir[] = []
  const collisionKeys = new Set<string>()
  let totalBytes = 0n
  let entryCount = 0

  const validatePath = (rel: string): void => {
    if (!isSafeRelativeSubpath(rel, { maxLength: limits.maxPathLength, maxDepth: limits.maxPathDepth })) {
      throw new UnportableSourceError(rel, 'not a portable relative subpath')
    }
    const key = portableCollisionKey(rel)
    if (collisionKeys.has(key)) throw new UnportableSourceError(rel, 'case/NFC-collides with another entry')
    collisionKeys.add(key)
  }

  const countOne = (rel: string): void => {
    entryCount++
    if (entryCount > limits.maxEntries) throw new CeilingExceededError('entry-count', `${rel}: > ${limits.maxEntries}`)
  }

  const walk = async (dir: string): Promise<void> => {
    throwIfAborted(signal)
    const names = await readdir(dir)
    for (const name of names) {
      throwIfAborted(signal)
      const abs = path.join(dir, name)
      const st = await lstat(abs, { bigint: true })
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) {
        throw new NonRegularSourceError(abs)
      }
      const rel = toPosixRel(rootDir, abs)

      if (st.isDirectory()) {
        // Directories are archived and counted too — validate their names.
        validatePath(rel)
        countOne(rel)
        dirs.push({ relPath: rel, id: fsIdentityOf(st, 'dir') })
        await walk(abs)
        continue
      }

      if (excludeKnowledgeDerivedIndex && isKnowledgeDerivedIndexPath(rel)) continue

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
      entries.push({ relPath: rel, size: Number(size), id: fsIdentityOf(st, 'file') })
    }
  }

  await walk(rootDir)
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  dirs.sort((a, b) => Buffer.compare(Buffer.from(a.relPath, 'utf8'), Buffer.from(b.relPath, 'utf8')))
  return { entries, dirs, rootId: fsIdentityOf(rootStat, 'dir'), entryCount, totalBytes }
}
