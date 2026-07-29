import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fsyncDirectorySync, renameOnlySync } from '@main/utils/file'

import { findCrossDeviceEndpoint, findUnsafeAncestor } from './pathSafety'
import type { ResourceInstallEntry, SealedResourceInstallEntry } from './restoreJournalV2'
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

export interface PreflightedResourceInstallUnit {
  readonly staged: string
  readonly live: string
  readonly aside: string
  readonly liveRel: string
  readonly livePresent: boolean
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

function assertRecoverySource(resourceType: ResourceUnit['resourceType'], source: string, label: string): void {
  const stats = fs.lstatSync(source)
  const matches = resourceType === 'file' ? stats.isFile() : stats.isDirectory()
  if (stats.isSymbolicLink() || !matches) {
    throw new ResourceInstallError('recovery-source-invalid', `${label} is not a regular ${resourceType}`)
  }
}

function inspectForwardUnit(entry: ResourceInstallEntry, userData: string): PreflightedResourceInstallUnit {
  const unit = resolveUnit(userData, entry)
  const staged = lstatOrNull(unit.staged)
  if (staged === null) {
    throw new ResourceInstallError('staged-missing', unit.liveRel)
  }
  const stagedMatches = unit.resourceType === 'file' ? staged.isFile() : staged.isDirectory()
  if (staged.isSymbolicLink() || !stagedMatches) {
    throw new ResourceInstallError(
      'recovery-source-invalid',
      `${unit.liveRel} staging is not a regular ${unit.resourceType}`
    )
  }

  const live = lstatOrNull(unit.live)
  if (live?.isSymbolicLink()) {
    throw new ResourceInstallError('target-not-installable', `${unit.liveRel} is a symlink`)
  }
  if (live !== null) {
    const liveMatches = unit.resourceType === 'file' ? live.isFile() : live.isDirectory()
    if (!liveMatches) {
      throw new ResourceInstallError('target-type-mismatch', `${unit.liveRel} is not a ${unit.resourceType}`)
    }
  }

  if (lstatOrNull(unit.aside) !== null) {
    throw new ResourceInstallError('aside-occupied', unit.liveRel)
  }

  return { ...unit, livePresent: live !== null }
}

/**
 * Prove — for EVERY unit, before the first one moves — that each of the three
 * slots a pass may rename between is still somewhere this operation may act:
 * no ancestor below userData has become a symlink or a non-directory, and every
 * slot's rename lands on userData's own filesystem.
 *
 * Both proofs cover all three slots together and run as one pre-pass, because
 * the frozen contract's promise is to fail BEFORE any mutation. Checking a unit
 * as it is reached would discover a bind-mounted staging tree only after the
 * previous unit's target had already been parked aside — recoverable, but a
 * mutation the contract says never happens.
 */
function assertRenameSlotsSafe(entries: readonly ResourceInstallEntry[], userData: string): void {
  const slots = entries.flatMap((entry) => [entry.staging, entry.live, entry.aside])
  for (const relativePath of slots) {
    const unsafe = findUnsafeAncestor(userData, relativePath)
    if (unsafe !== null) {
      throw new ResourceInstallError('unsafe-ancestor', `${relativePath} passes through ${unsafe}`)
    }
  }
  const crossed = findCrossDeviceEndpoint(userData, slots)
  if (crossed !== null) {
    throw new ResourceInstallError('cross-filesystem', `${crossed} is not on the userData filesystem`)
  }
}

/**
 * Re-read every forward-install slot at the arm boundary and persist the live
 * target existence fact the preboot recovery table will later depend on.
 *
 * The prepared journal may contain an older observation; no mutation has
 * started yet, so a legitimate target creation/removal is resealed rather than
 * treated as corruption. Unsafe types, occupied asides, missing staging, and
 * unsafe/cross-device topology still refuse the arm.
 */
export function sealResourceInstallEntriesAtArm(
  entries: readonly ResourceInstallEntry[],
  userData: string
): readonly SealedResourceInstallEntry[] {
  assertRenameSlotsSafe(entries, userData)
  return entries.map((entry) => {
    const unit = inspectForwardUnit(entry, userData)
    return { ...entry, hadLive: unit.livePresent }
  })
}

/**
 * Validate every install unit before the first rename.
 *
 * New journals must match the arm-sealed `hadLive` fact exactly. A pre-release
 * journal without that optional read-compatibility field may still promote,
 * but remains ineligible for rollback as documented by the journal schema.
 */
export function preflightResourceInstallUnits(
  entries: readonly ResourceInstallEntry[],
  userData: string
): readonly PreflightedResourceInstallUnit[] {
  assertRenameSlotsSafe(entries, userData)
  return entries.map((entry) => {
    const unit = inspectForwardUnit(entry, userData)
    if (entry.hadLive !== undefined && entry.hadLive !== unit.livePresent) {
      throw new ResourceInstallError(
        'target-presence-changed',
        `${unit.liveRel} existence no longer matches the armed restore`
      )
    }
    return unit
  })
}

/** Test seam for the platform-specific directory durability tail. */
export const resourceInstallDurability = {
  syncDirectory(dir: string): void {
    fsyncDirectorySync(dir)
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
      fs.mkdirSync(directory, { mode: 0o700 })
      // Creating a directory changes its parent's entry; syncing only the new
      // directory does not make that parent entry durable.
      this.dirs.add(path.dirname(directory))
      this.dirs.add(directory)
    }
  }

  rename(source: string, target: string): void {
    this.ensureDirectory(path.dirname(target))
    try {
      renameOnlySync(source, target)
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
  const units = preflightResourceInstallUnits(entries, userData)
  const batch = new DirBatch()

  for (const unit of units) {
    if (unit.livePresent) {
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
  // Explicit rollback can run long after installation, so re-prove every rename
  // slot. A newly symlinked ancestor must not redirect recovery outside userData
  // while the journal's relative paths still look contained.
  assertRenameSlotsSafe(entries, userData)
  const batch = new DirBatch()

  for (const entry of entries) {
    const unit = resolveUnit(userData, entry)
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
        //
        // Unless the journal says the target DID exist: then the aside that
        // held the user's original is missing, `live` is the only copy of
        // anything this unit still has, and taking it out would leave nothing
        // behind. An entry with no `hadLive` (an earlier pre-release wrote it)
        // keeps the original reading — the callers that must not act on a guess
        // refuse before they get here.
        if (entry.hadLive === true) {
          throw new ResourceInstallError(
            'aside-missing',
            `${unit.liveRel} was replaced but its pre-restore copy is gone — refusing to remove the only copy left`
          )
        }
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
 * Why this completed restore's units cannot be reversed, or `null` if they can.
 *
 * Rollback moves the pre-restore copies OUT of their asides and the restored
 * ones back into staging — a plan whose every step assumes the shape completion
 * left behind. Proving that shape here, before consent is written, is the only
 * place a failure is still free: once the reverse direction is armed, preboot
 * has to carry it out, and a unit whose aside vanished can then only be
 * discovered mid-pass, with some units already moved.
 *
 * The detail is for the log, never for the user: it names journal paths.
 */
export function findRollbackBlocker(entries: readonly ResourceInstallEntry[], userData: string): string | null {
  for (const entry of entries) {
    if (entry.hadLive === undefined) {
      return `${entry.live}: written by an earlier build that did not record whether it replaced anything`
    }
    const facts = probe(resolveUnit(userData, entry))
    if (!facts.live) return `${entry.live}: the restored node is no longer in its live slot`
    if (facts.staged) return `${entry.live}: an archive copy still occupies the staging slot`
    if (facts.aside !== entry.hadLive) {
      return entry.hadLive
        ? `${entry.live}: the pre-restore copy is missing from its aside`
        : `${entry.live}: an aside exists although nothing was replaced here`
    }
  }
  return null
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
