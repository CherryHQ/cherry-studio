import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'

import type { ResourceInstallEntry } from './restoreJournalV2'
import { decideRecoveryAction, type RecoveryPhase } from './restoreRecovery'

/**
 * The unified `resource-install` operation (docs/references/backup/README.md
 * §6.3, §6.4) — the resource half of the promotion, executed in the same
 * zero-connection preboot window as the database replacement and under the same
 * durable step marker.
 *
 * Every unit installs by RENAME and nothing else. That single choice is what
 * makes the operation crash-recoverable from existence facts alone: the backup
 * copy lives in exactly one of `{staging, live}` at any instant, so a crash can
 * never leave a half-written file, and a directory unit can never become a
 * recursive mixture of old and archive content (§7) because a rename never
 * merges trees.
 *
 * The inverse is the same set of renames in reverse, decided per unit by the
 * shared table in `./restoreRecovery.ts` — the DB unit's `uninstall` remap does
 * NOT apply here: a resource target that was originally absent must be taken
 * back out on rollback, which is exactly what that row means.
 *
 * DURABILITY BOUND (§5.3): renames here do NOT fsync individually. The affected
 * parent directories are fsynced ONCE EACH after the whole batch, before the
 * caller writes the step marker, so preboot cost scales with affected
 * directories rather than with entry count.
 *
 * WHY RECOVERY NEVER DELETES. The recovery table reads `pre-commit` with only
 * `live` present as "an installed backup over an originally-absent target →
 * remove it". A rolled-back unit whose target DID exist reaches the very same
 * triple once its aside has been restored — so a recovery pass that deleted, and
 * was then re-entered after a crash, would delete the user's original. Recovery
 * here therefore only ever MOVES: the archive copy goes back to the staging
 * slot, which leaves every rolled-back unit at `(staged, live)` or `(staged)`,
 * both of which the table reads as "drop the staged copy, keep the target" — a
 * no-op for this pass, and the same no-op on every re-entry. Dropping the staged
 * copies is the terminal cleanup's single job, and the caller performs it only
 * AFTER the journal is terminal.
 *
 * Residual, documented: the defensive `(aside)`-only state — unreachable from
 * the install algorithm — restores to `(live)` alone, which a further crash
 * would read as an installed backup.
 */

const logger = loggerService.withContext('ResourceInstallV2')

/** A resource unit could not be installed or rolled back; the promotion must fail closed. */
export class ResourceInstallError extends Error {
  readonly code: string
  constructor(code: string, detail: string) {
    super(`resource install failed (${code}): ${detail}`)
    this.name = 'ResourceInstallError'
    this.code = code
  }
}

interface ResourceUnit {
  readonly resourceType: 'file' | 'directory'
  /** Absolute paths resolved against the CURRENT userData (relocation-safe, §6.6). */
  readonly staged: string
  readonly live: string
  readonly aside: string
  readonly liveRel: string
}

interface UnitFacts {
  readonly staged: boolean
  readonly live: boolean
  readonly aside: boolean
}

function resolveUnit(userData: string, entry: ResourceInstallEntry): ResourceUnit {
  return {
    resourceType: entry.resourceType,
    staged: path.resolve(userData, ...entry.staging.split('/')),
    live: path.resolve(userData, ...entry.live.split('/')),
    aside: path.resolve(userData, ...entry.aside.split('/')),
    liveRel: entry.live
  }
}

function probe(unit: ResourceUnit): UnitFacts {
  return {
    staged: fs.existsSync(unit.staged),
    live: fs.existsSync(unit.live),
    aside: fs.existsSync(unit.aside)
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Re-prove — at execution time, not just at journal sealing — that the target is
 * something a rename may replace. The target can change between preparation and
 * boot, and the answer must be the same one both earlier gates gave: a symlink
 * or special node is never an install target, and a target whose type differs
 * from the unit would have to be destroyed to make room, taking target-only
 * descendants with it (§6.3).
 */
function assertTargetInstallable(unit: ResourceUnit): void {
  const stats = lstatOrNull(unit.live)
  if (stats === null) return
  if (stats.isSymbolicLink()) {
    throw new ResourceInstallError('target-not-installable', `${unit.liveRel} is a symlink`)
  }
  const matches = unit.resourceType === 'file' ? stats.isFile() : stats.isDirectory()
  if (!matches) {
    throw new ResourceInstallError('target-type-mismatch', `${unit.liveRel} is not a ${unit.resourceType}`)
  }
}

function assertRecoverySource(resourceType: ResourceUnit['resourceType'], source: string, label: string): void {
  const stats = fs.lstatSync(source)
  const matches = resourceType === 'file' ? stats.isFile() : stats.isDirectory()
  if (stats.isSymbolicLink() || !matches) {
    throw new ResourceInstallError('recovery-source-invalid', `${label} is not a regular ${resourceType}`)
  }
}

/**
 * Every EXISTING ancestor of the target, below userData, must still be a real
 * directory. A symlinked ancestor would silently redirect the install outside
 * every registered root while the relative path still looked contained.
 */
function assertAncestorsSafe(userData: string, relativePath: string): void {
  const segments = relativePath.split('/')
  segments.pop()
  let current = userData
  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = lstatOrNull(current)
    if (stats === null) return
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ResourceInstallError('unsafe-ancestor', `${relativePath} passes through ${segment}`)
    }
  }
}

/** Test seam for the platform-specific directory durability tail. */
export const resourceInstallDurability = {
  syncDirectory(dir: string): void {
    if (process.platform === 'win32') return
    const fd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }
}

/** Collects the directories whose entries changed, so they can be fsynced once each. */
class DirBatch {
  private readonly dirs = new Set<string>()

  private ensureDirectory(target: string): void {
    const missing: string[] = []
    let current = target
    while (true) {
      const stats = lstatOrNull(current)
      if (stats !== null) {
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new ResourceInstallError('unsafe-target-parent', current)
        }
        break
      }
      missing.push(current)
      const parent = path.dirname(current)
      if (parent === current) throw new ResourceInstallError('unsafe-target-parent', target)
      current = parent
    }

    for (const directory of missing.reverse()) {
      fs.mkdirSync(directory)
      // Creating a directory changes its parent's entry; syncing only the new
      // directory does not make that parent entry durable.
      this.dirs.add(path.dirname(directory))
      this.dirs.add(directory)
    }
  }

  rename(source: string, target: string): void {
    this.ensureDirectory(path.dirname(target))
    try {
      fs.renameSync(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        throw new ResourceInstallError('cross-filesystem', `${source} → ${target}`)
      }
      throw error
    }
    this.dirs.add(path.dirname(source))
    this.dirs.add(path.dirname(target))
  }

  /**
   * One fsync per affected directory, never one per entry (§5.3). Windows cannot
   * fsync a directory handle and Node/libuv rename does not request
   * `MOVEFILE_WRITE_THROUGH`; Windows therefore guarantees process-crash
   * recovery here, not sudden-power-loss metadata durability.
   */
  flush(): readonly string[] {
    const dirs = [...this.dirs].sort()
    for (const dir of dirs) resourceInstallDurability.syncDirectory(dir)
    this.dirs.clear()
    return dirs
  }
}

/**
 * Install every declared unit. Runs BEFORE the database commit boundary, so a
 * failure here still has a complete rollback available: the caller reverts the
 * units through {@link recoverResourceUnits} and the old database was never
 * moved.
 */
export function installResourceUnits(entries: readonly ResourceInstallEntry[], userData: string): void {
  if (entries.length === 0) return
  const batch = new DirBatch()

  for (const entry of entries) {
    const unit = resolveUnit(userData, entry)
    const facts = probe(unit)

    if (!facts.staged) {
      // Forward installation is entered exactly once. Crash re-entry is resolved
      // by recoverResourceUnits() before this path, so a live target cannot prove
      // that the missing archive payload was ever installed.
      throw new ResourceInstallError('staged-missing', unit.liveRel)
    }

    assertAncestorsSafe(userData, entry.staging)
    assertAncestorsSafe(userData, entry.live)
    assertAncestorsSafe(userData, entry.aside)
    assertRecoverySource(unit.resourceType, unit.staged, `${unit.liveRel} staging`)
    assertTargetInstallable(unit)

    if (facts.live) {
      if (facts.aside) {
        throw new ResourceInstallError('aside-occupied', unit.liveRel)
      }
      batch.rename(unit.live, unit.aside)
    }
    batch.rename(unit.staged, unit.live)
  }

  const dirs = batch.flush()
  logger.info('Installed archive resources', { units: entries.length, fsyncedDirs: dirs.length })
}

/**
 * Bring every unit to the terminal state its recovery direction demands: undone
 * before the commit, finished after it. Each unit is decided independently from
 * its own `(staged, live, aside)` triple, so units interrupted at different
 * points in the same crash all resolve correctly.
 *
 * Move-only, and therefore safe to re-enter after a crash mid-recovery — see the
 * module header. The staged copies this leaves behind are removed with the
 * staging tree once the journal is terminal.
 */
export function recoverResourceUnits(
  entries: readonly ResourceInstallEntry[],
  userData: string,
  phase: RecoveryPhase
): void {
  if (entries.length === 0) return
  const batch = new DirBatch()

  for (const entry of entries) {
    const unit = resolveUnit(userData, entry)
    // Explicit rollback can run long after installation, so re-prove every
    // rename parent. A newly symlinked ancestor must not redirect recovery
    // outside userData while the journal's relative paths still look contained.
    assertAncestorsSafe(userData, entry.staging)
    assertAncestorsSafe(userData, entry.live)
    assertAncestorsSafe(userData, entry.aside)
    const facts = probe(unit)
    const action = decideRecoveryAction({ phase, ...facts })

    switch (action) {
      case 'noop':
      case 'discard-staged':
      case 'complete':
        // Nothing occupies a slot it shouldn't; a staged copy left over is
        // garbage the terminal cleanup collects wholesale.
        break
      case 'uninstall':
        // No aside ⇒ the target was originally absent ⇒ the node in `live` is
        // the archive's copy. Park it back in the staging slot, which both
        // empties the target (the target-only preservation rule) and makes this
        // unit read as `discard-staged` if the pass is ever re-entered.
        batch.rename(unit.live, unit.staged)
        break
      case 'restore-aside':
        // The aside holds the original target, so whatever occupies `live` is
        // the archive's copy: park it before the original comes back.
        assertRecoverySource(unit.resourceType, unit.aside, `${unit.liveRel} aside`)
        if (facts.live) batch.rename(unit.live, unit.staged)
        batch.rename(unit.aside, unit.live)
        break
      case 'install-forward':
        assertRecoverySource(unit.resourceType, unit.staged, `${unit.liveRel} staging`)
        batch.rename(unit.staged, unit.live)
        break
      case 'abort-inconsistent':
        throw new ResourceInstallError(
          'inconsistent',
          `${unit.liveRel} (${phase}: staged=${facts.staged} live=${facts.live} aside=${facts.aside})`
        )
    }
  }

  const dirs = batch.flush()
  logger.warn('Recovered archive resources', { units: entries.length, phase, fsyncedDirs: dirs.length })
}

/**
 * Knowledge base IDs among the installed units, for the durable restore summary
 * the post-promotion reindex scheduler consumes (§6.7). Derived from the live
 * paths rather than from a journal field: the entry describes a rename, and
 * which registered root a path sits under is the only thing that makes it a
 * Knowledge base.
 */
export function installedKnowledgeBaseIds(
  entries: readonly ResourceInstallEntry[],
  userData: string,
  knowledgeRoot: string
): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.resourceType !== 'directory') continue
    const absolute = path.resolve(userData, ...entry.live.split('/'))
    if (path.dirname(absolute) !== path.resolve(knowledgeRoot)) continue
    ids.push(path.basename(absolute))
  }
  return ids
}
