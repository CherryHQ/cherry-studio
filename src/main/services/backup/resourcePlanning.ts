/**
 * Resource planning contracts — frozen up-front so A1/A2 (core) and B1-B4
 * (peripheral) workstreams can proceed in parallel.
 *
 * `ResourcePlan` is one value with three consumers:
 *   - merge input   : skippedFileEntryIds / skippedKnowledgeBaseIds /
 *                     skippedSkillFolderNames + stagedFileEntryIds (drive
 *                     MergeEngine skip + disclose — every class same-source)
 *   - journal source : resources (serialized into RestoreJournal.fileResources)
 *   - disclosure UI  : skips + toRestore (mirror into RestoreResultSummary)
 *
 * Conflict policy: every class skips on conflict (local DB row OR disk exists),
 * matching merge — file_entry via skippedFileEntryIds, knowledge_base via
 * skippedKnowledgeBaseIds, skills via skippedSkillFolderNames. No overwrite.
 * The work.sqlite input makes planning's DB-row conflict check same-source as
 * merge SKIP (avoids existsSync-only divergence → orphan blob / mixed entity).
 */

import type { FileResource } from '@main/data/db/restore/restoreJournal'
import type { ResourceClass } from '@shared/types/backup'

import type { BackupManifest } from './manifest'

/** A file resource restricted to additive kinds (no overwrite/note-overwrite in this PR). */
export type AddFileResource = Extract<FileResource, { kind: 'blob-add' | 'dir-add' | 'note-add' }>

/**
 * Roots planning resolves livePaths against + containment-checks. notesRoot is a
 * resolver (preference-driven; may point outside userData → its notes skip).
 */
export interface PlanRoots {
  readonly files: string
  readonly knowledge: string
  readonly skills: string
  readonly notes: () => string | undefined
}

/**
 * A resource the plan skipped (conflict / unmanaged / etc). 1:1 source for the
 * relaunch-result disclosure UI (RestoreResultSummary.toSkip).
 */
export interface SkippedResource {
  readonly id: string
  readonly kind: ResourceClass
  readonly reason: string
}

/**
 * Input to planResources. `workPath` is the post-snapshot local-state
 * work.sqlite — planning's DB-row conflict check reads it so the decision is
 * same-source as merge SKIP (snapshot happens before planning, §5 时序).
 */
export interface PlanCtx {
  readonly manifest: BackupManifest
  readonly workDir: string
  readonly backupDbPath: string
  readonly workPath: string
  readonly userData: string
  readonly roots: PlanRoots
}

/**
 * Output of resource planning (runs before merge, full-restore-plan §5 段1).
 *
 * Conflict: every class skips on conflict (local DB row OR disk exists),
 * matching merge SKIP — no overwrite in this PR.
 */
export interface ResourcePlan {
  /** file_entry ids whose blob will be staged → merge discloses soft-refs correctly. */
  readonly stagedFileEntryIds: Set<string>
  /** file_entry ids skipped due to CONFLICT (local row OR disk exists) → merge does NOT import the row (no dangling). External/missing/wrong-type are ARCHIVE_CORRUPT, not skip. */
  readonly skippedFileEntryIds: Set<string>
  /** knowledge_base baseIds skipped due to conflict → merge must skip the root so the DB row isn't inserted while its dir isn't moved (same-source as file_entry). */
  readonly skippedKnowledgeBaseIds: Set<string>
  /** skill folderNames skipped due to conflict → merge must skip the root (same-source as file_entry / knowledge). */
  readonly skippedSkillFolderNames: Set<string>
  /** Additive file resources (blob-add/dir-add/note-add only; no overwrite). Serialized into journal.fileResources. */
  readonly resources: AddFileResource[]
  /** Pre-computed restore counts by class (knowledge vs skill stay distinguishable; not reverse-derived from resources). */
  readonly toRestore: ReadonlyArray<{ readonly kind: ResourceClass; readonly count: number }>
  /** Skipped resources with reason → relaunch-result disclosure UI. */
  readonly skips: SkippedResource[]
}
