/**
 * Resource planning contracts — frozen up-front so A1/A2 (core) and B1-B4
 * (peripheral) workstreams can proceed in parallel.
 *
 * `ResourcePlan` is one value with three consumers:
 *   - merge input   : skippedFileEntryIds / skippedKnowledgeBaseIds /
 *                     skippedSkillFolderNames + stagedFileEntryIds + noteAdditions
 *                     (drive MergeEngine skip + disclose — every class same-source)
 *   - journal source : resources (serialized into RestoreJournal.fileResources)
 *   - disclosure UI  : skips + toRestore (mirror into RestoreResultSummary)
 *
 * Conflict policy: every class skips on conflict (local DB row OR disk exists),
 * matching merge — file_entry via skippedFileEntryIds, knowledge_base via
 * skippedKnowledgeBaseIds, skills via skippedSkillFolderNames. No overwrite.
 * The work.sqlite input makes planning's DB-row conflict check same-source as
 * merge SKIP (avoids existsSync-only divergence → orphan blob / mixed entity).
 */

import { existsSync, lstatSync, statSync } from 'node:fs'
import path from 'node:path'

import { type PathResolvableEntry, resolvePhysicalPath } from '@main/services/file'
import { isPathInside } from '@main/utils/file'
import { FileEntryIdSchema, SafeNameSchema } from '@shared/data/types/file'
import type { ResourceClass, RestoreSkipReasonCode } from '@shared/types/backup'
import { SafeExtSchema } from '@shared/types/file'
import Database from 'better-sqlite3'

import { BackupArchiveCorruptError } from './errors'
import type { BackupManifest } from './manifest'
import { buildMergedNotesTreeSync } from './notesMergedTree'
import { presetIncludesFiles, resolvePreset } from './presets'

/** An additive resource (no overwrite). */
export type AddFileResource = {
  readonly kind: 'blob-add' | 'dir-add' | 'note-add'
  readonly stagingPath: string
  readonly livePath: string
}

/** A directory-level near-atomic Notes tree swap (t5 dir-swap). */
export type TreeSwapResource = {
  readonly kind: 'notes-tree-swap'
  readonly rootPath: string
  readonly stagingPath: string
  readonly livePath: string
  readonly asideTreePath: string
  readonly treeHash: string
}

/** Any resource the plan emits (additive or tree-swap). */
export type PlannedResource = AddFileResource | TreeSwapResource

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
  readonly reasonCode: RestoreSkipReasonCode
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
  /**
   * Root for parked-aside undo trees (notes-tree-swap). When set, per-restore aside sub-dirs
   * live under it (out of the staging tree so terminal staging cleanup does not delete them).
   * Should be `application.getPath('feature.backup.restore.aside')` in production so the path
   * is registry-owned and discoverable by the GC sweep. Falls back to a userData-relative
   * `restore-aside` dir for pure/unit callers that do not inject a registry path.
   */
  readonly asideRoot?: string
  /**
   * t5: when true, plan a directory-level notes-tree-swap (OVERWRITE semantics: the merged
   * tree — local-only + backup-only, conflicts local-first — atomically replaces the live
   * Notes tree, old tree parked aside for undo). Default false → additive note-add (MERGE
   * semantics, current behavior). Tree-swap requires the notes root to be managed/in-
   * userData on the same device as staging (rename atomicity); otherwise it falls back to
   * additive. Gated by an explicit flag so the default restore stays non-destructive until a
   * conflict-preview UI opts in.
   */
  readonly forceNotesTreeSwap?: boolean
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
  /** Planned file resources (additive blob/dir/note-add, or a notes-tree-swap for a full dir-swap). Serialized into journal.fileResources. */
  readonly resources: PlannedResource[]
  /** Planned note body path → resolved target Notes root. Merge imports an overlay only for these note-add entries. */
  readonly noteAdditions: ReadonlyMap<string, string>
  /** Pre-computed restore counts by class (knowledge vs skill stay distinguishable; not reverse-derived from resources). */
  readonly toRestore: ReadonlyArray<{ readonly kind: ResourceClass; readonly count: number }>
  /** Skipped resources with stable reason codes → relaunch-result disclosure UI. */
  readonly skips: SkippedResource[]
}

const EMPTY_PLAN: ResourcePlan = {
  stagedFileEntryIds: new Set(),
  skippedFileEntryIds: new Set(),
  skippedKnowledgeBaseIds: new Set(),
  skippedSkillFolderNames: new Set(),
  resources: [],
  noteAdditions: new Map(),
  toRestore: [],
  skips: []
}

/** Raw better-sqlite3 row from backup.sqlite `file_entry` (snake_case columns). */
interface FileEntrySqlRow {
  readonly id: string
  readonly origin: string
  readonly ext: string | null
  readonly external_path: string | null
}

interface IdSqlRow {
  readonly id: string
}

function archiveCorrupt(detail: string): never {
  throw new BackupArchiveCorruptError(detail)
}

/** True when two paths reside on the same filesystem device (same-volume rename is atomic). */
function sameDevice(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev
  } catch {
    return false
  }
}

/**
 * Full-preset cross-field invariants (P0-2). No-op for non-full.
 * Domains must equal `resolvePreset('full')`; include* flags must match resource
 * array emptiness — empty attachment libraries may legally set includeFiles:false.
 */
export function assertFullManifestInvariants(manifest: BackupManifest): void {
  if (manifest.preset !== 'full') return

  const expected = resolvePreset('full')
  const expectedSet = new Set(expected)
  const actualSet = new Set(manifest.domains)
  if (actualSet.size !== manifest.domains.length || actualSet.size !== expectedSet.size) {
    archiveCorrupt('full manifest domains do not match resolvePreset(full)')
  }
  for (const d of expectedSet) {
    if (!actualSet.has(d)) {
      archiveCorrupt('full manifest domains do not match resolvePreset(full)')
    }
  }

  if (manifest.includeFiles !== manifest.files.ids.length > 0) {
    archiveCorrupt(
      `full manifest includeFiles=${manifest.includeFiles} inconsistent with files.ids.length=${manifest.files.ids.length}`
    )
  }
  if (manifest.includeKnowledgeFiles !== manifest.knowledge.bases.length > 0) {
    archiveCorrupt(
      `full manifest includeKnowledgeFiles=${manifest.includeKnowledgeFiles} inconsistent with knowledge.bases.length=${manifest.knowledge.bases.length}`
    )
  }

  // Ids double as staging path segments (workDir/files/{id}) — reject any shape
  // that isn't a file_entry UUID before uniqueness (hardening; live containment
  // already bounds escapes to ARCHIVE_CORRUPT).
  for (const id of manifest.files.ids) {
    if (!FileEntryIdSchema.safeParse(id).success) {
      archiveCorrupt(`files.ids entry is not a file entry UUID: ${id}`)
    }
  }
  assertUniqueIds(manifest.files.ids, 'files.ids')
  assertUniqueSafeNames(manifest.knowledge.bases, 'knowledge.bases')
  assertUniqueSafeNames(
    manifest.skills.folders.map((f) => f.folderName),
    'skills.folders.folderName'
  )
  assertUniqueIds(manifest.notes.paths, 'notes.paths')
  for (const relPath of manifest.notes.paths) {
    if (relPath.split(/[/\\]/).includes('..')) {
      archiveCorrupt(`note relPath contains '..': ${relPath}`)
    }
  }
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) archiveCorrupt(`duplicate ${label}: ${id}`)
    seen.add(id)
  }
}

function assertUniqueSafeNames(names: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const name of names) {
    const parsed = SafeNameSchema.safeParse(name)
    if (!parsed.success) archiveCorrupt(`unsafe ${label}: ${name}`)
    if (seen.has(name)) archiveCorrupt(`duplicate ${label}: ${name}`)
    seen.add(name)
  }
}

/** Staging payload must exist as a regular file (not symlink / dir). Uses lstat. */
export function assertStagingFile(absPath: string): void {
  let st
  try {
    st = lstatSync(absPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      archiveCorrupt(`staging file missing: ${absPath}`)
    }
    throw e
  }
  if (st.isSymbolicLink()) archiveCorrupt(`staging file is symlink: ${absPath}`)
  if (!st.isFile()) archiveCorrupt(`staging path is not a regular file: ${absPath}`)
}

/** Staging payload must exist as a directory (not symlink / file). Uses lstat. */
export function assertStagingDir(absPath: string): void {
  let st
  try {
    st = lstatSync(absPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      archiveCorrupt(`staging dir missing: ${absPath}`)
    }
    throw e
  }
  if (st.isSymbolicLink()) archiveCorrupt(`staging dir is symlink: ${absPath}`)
  if (!st.isDirectory()) archiveCorrupt(`staging path is not a directory: ${absPath}`)
}

/**
 * Map a raw sqlite file_entry row to PathResolvableEntry. Internal-only after
 * origin gate — external_path is never passed through for livePath resolution.
 */
export function toPathResolvable(row: FileEntrySqlRow): PathResolvableEntry {
  if (row.origin !== 'internal') {
    archiveCorrupt(`file ${row.id}: expected internal origin, got ${row.origin}`)
  }
  // ext feeds `{id}.{ext}` path composition and backup.sqlite is untrusted —
  // reject separators/dots before resolvePhysicalPath sees them.
  if (row.ext !== null && !SafeExtSchema.safeParse(row.ext).success) {
    archiveCorrupt(`file ${row.id}: unsafe ext`)
  }
  return { id: row.id, origin: 'internal', ext: row.ext }
}

function assertSameManifestIds(
  manifestIds: ReadonlySet<string>,
  backupIds: ReadonlySet<string>,
  category: string
): void {
  for (const id of backupIds) {
    if (!manifestIds.has(id)) {
      archiveCorrupt(`${category}: manifest omits an active backup DB entry`)
    }
  }
  for (const id of manifestIds) {
    if (!backupIds.has(id)) {
      archiveCorrupt(`${category}: manifest includes an entry absent from the active backup DB set`)
    }
  }
}

/**
 * Full archives must describe the active resource rows in backup.sqlite exactly.
 * Check this before per-resource staging validation so omitted rows cannot be
 * silently restored without their filesystem resources.
 */
function assertFullResourceManifestSets(manifest: BackupManifest, backupDb: Database.Database): void {
  const activeInternalFileIds = new Set(
    (
      backupDb.prepare("SELECT id FROM file_entry WHERE origin = 'internal' AND deleted_at IS NULL").all() as IdSqlRow[]
    ).map(({ id }) => id)
  )
  assertSameManifestIds(new Set(manifest.files.ids), activeInternalFileIds, 'files')

  const knowledgeBaseIds = new Set(
    (backupDb.prepare('SELECT id FROM knowledge_base').all() as IdSqlRow[]).map(({ id }) => id)
  )
  assertSameManifestIds(new Set(manifest.knowledge.bases), knowledgeBaseIds, 'knowledge')
}

function buildToRestore(counts: Record<ResourceClass, number>): ResourcePlan['toRestore'] {
  const order: ResourceClass[] = ['file', 'knowledge', 'skill', 'note']
  return order.filter((k) => counts[k] > 0).map((kind) => ({ kind, count: counts[kind] }))
}

/**
 * Plan restore file resources before merge. Pure w.r.t. live FS mutation —
 * only reads workDir / backup.sqlite / work.sqlite / roots.
 */
export function planResources(ctx: PlanCtx): ResourcePlan {
  assertFullManifestInvariants(ctx.manifest)
  if (!presetIncludesFiles(ctx.manifest.preset)) return EMPTY_PLAN

  const { manifest, workDir, backupDbPath, workPath, userData, roots } = ctx
  const stagedFileEntryIds = new Set<string>()
  const skippedFileEntryIds = new Set<string>()
  const skippedKnowledgeBaseIds = new Set<string>()
  const skippedSkillFolderNames = new Set<string>()
  const resources: PlannedResource[] = []
  const noteAdditions = new Map<string, string>()
  const skips: SkippedResource[] = []
  const counts: Record<ResourceClass, number> = { file: 0, knowledge: 0, skill: 0, note: 0 }

  const toRel = (abs: string): string => {
    const rel = path.relative(userData, abs)
    if (path.isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
      archiveCorrupt(`path escapes userData: ${abs}`)
    }
    return rel
  }

  // Both opens live inside the try: if the second constructor throws, the
  // finally still closes the first (readonly handles pin the file on Windows).
  let backupDb: Database.Database | undefined
  let workDb: Database.Database | undefined
  try {
    backupDb = new Database(backupDbPath, { readonly: true, fileMustExist: true })
    assertFullResourceManifestSets(manifest, backupDb)
    workDb = new Database(workPath, { readonly: true, fileMustExist: true })

    // One prepare per statement — the loops below run on the main thread while
    // quiesce is held, and better-sqlite3 has no statement cache.
    const backupFileEntry = backupDb.prepare('SELECT id, origin, ext, external_path FROM file_entry WHERE id = ?')
    const workFileEntry = workDb.prepare('SELECT 1 AS ok FROM file_entry WHERE id = ?')
    const backupKnowledgeBase = backupDb.prepare('SELECT 1 AS ok FROM knowledge_base WHERE id = ?')
    const workKnowledgeBase = workDb.prepare('SELECT 1 AS ok FROM knowledge_base WHERE id = ?')
    const backupSkill = backupDb.prepare('SELECT 1 AS ok FROM agent_global_skill WHERE folder_name = ?')
    const workSkill = workDb.prepare('SELECT 1 AS ok FROM agent_global_skill WHERE folder_name = ?')

    // ── files ──
    for (const id of manifest.files.ids) {
      const row = backupFileEntry.get(id) as FileEntrySqlRow | undefined
      if (!row || row.origin !== 'internal') {
        archiveCorrupt(`file ${id}: missing or external`)
      }
      const stagingAbs = path.join(workDir, 'files', id)
      assertStagingFile(stagingAbs)
      const liveAbs = resolvePhysicalPath(toPathResolvable(row))
      if (!isPathInside(liveAbs, roots.files)) {
        archiveCorrupt(`file ${id}: outside filesRoot`)
      }
      const localRow = workFileEntry.get(id)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id,
          kind: 'file',
          reasonCode: localRow ? 'local_record_exists' : 'target_exists'
        })
        skippedFileEntryIds.add(id)
        continue
      }
      stagedFileEntryIds.add(id)
      resources.push({
        kind: 'blob-add' as const,
        stagingPath: toRel(stagingAbs),
        livePath: toRel(liveAbs)
      })
      counts.file += 1
    }

    // ── knowledge ──
    for (const baseId of manifest.knowledge.bases) {
      const backupRow = backupKnowledgeBase.get(baseId)
      if (!backupRow) archiveCorrupt(`knowledge ${baseId}: missing from backup DB`)
      const stagingAbs = path.join(workDir, 'knowledge', baseId)
      assertStagingDir(stagingAbs)
      const liveAbs = path.join(roots.knowledge, baseId)
      if (!isPathInside(liveAbs, roots.knowledge)) {
        archiveCorrupt(`knowledge ${baseId}: outside knowledgeRoot`)
      }
      const localRow = workKnowledgeBase.get(baseId)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id: baseId,
          kind: 'knowledge',
          reasonCode: localRow ? 'local_record_exists' : 'target_exists'
        })
        skippedKnowledgeBaseIds.add(baseId)
        continue
      }
      resources.push({
        kind: 'dir-add' as const,
        stagingPath: toRel(stagingAbs),
        livePath: toRel(liveAbs)
      })
      counts.knowledge += 1
    }

    // ── skills (folderName is merge identity; A2 matches backupRow.folder_name) ──
    for (const { folderName } of manifest.skills.folders) {
      const backupRow = backupSkill.get(folderName)
      if (!backupRow) archiveCorrupt(`skill ${folderName}: missing from backup DB`)
      const stagingAbs = path.join(workDir, 'skills', folderName)
      assertStagingDir(stagingAbs)
      const liveAbs = path.join(roots.skills, folderName)
      if (!isPathInside(liveAbs, roots.skills)) {
        archiveCorrupt(`skill ${folderName}: outside skillsRoot`)
      }
      const localRow = workSkill.get(folderName)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id: folderName,
          kind: 'skill',
          reasonCode: localRow ? 'local_record_exists' : 'target_exists'
        })
        skippedSkillFolderNames.add(folderName)
        continue
      }
      resources.push({
        kind: 'dir-add' as const,
        stagingPath: toRel(stagingAbs),
        livePath: toRel(liveAbs)
      })
      counts.skill += 1
    }

    // ── notes (managed / in-userData only) ──
    const notesRoot = roots.notes()
    if (manifest.notes.paths.length > 0 && !notesRoot) {
      for (const relPath of manifest.notes.paths) {
        if (relPath.split(/[/\\]/).includes('..')) {
          archiveCorrupt(`note relPath contains '..': ${relPath}`)
        }
        assertStagingFile(path.join(workDir, 'notes', relPath))
        skips.push({ id: relPath, kind: 'note', reasonCode: 'notes_root_unavailable' })
      }
    } else if (notesRoot) {
      // t5: a forced directory-level notes-tree-swap (OVERWRITE semantics) replaces the live
      // Notes tree atomically with a merged tree (local-only + backup-only, conflicts local-
      // first). Requires the notes root to be in-userData AND on the same device as staging
      // (same-volume rename is atomic; cross-volume is not). Falls back to additive otherwise.
      const canTreeSwap =
        ctx.forceNotesTreeSwap === true && isPathInside(notesRoot, userData) && sameDevice(notesRoot, workDir)
      if (canTreeSwap) {
        // Validate declared paths first (corrupt archive detection, same as additive).
        for (const relPath of manifest.notes.paths) {
          if (relPath.split(/[/\\]/).includes('..')) {
            archiveCorrupt(`note relPath contains '..': ${relPath}`)
          }
          assertStagingFile(path.join(workDir, 'notes', relPath))
        }
        const mergedDir = path.join(workDir, 'notes-merged')
        // aside sits OUTSIDE the staging tree (restore-staging/<rid>) so the terminal
        // removeStagingTree cleanup does not delete the parked live tree (undo source). The
        // asideRoot is registry-owned (application.getPath('feature.backup.restore.aside')) so
        // the GC sweep + crash-recovery can discover + clear stranded aside trees; per-restore
        // sub-dir is keyed by the staging basename (restoreId).
        const asideRoot = ctx.asideRoot ?? path.join(userData, 'restore-aside')
        const asideDir = path.join(asideRoot, path.basename(workDir))
        const merged = buildMergedNotesTreeSync(path.join(workDir, 'notes'), notesRoot, mergedDir, manifest.notes.paths)
        for (const conflict of merged.conflicts) {
          skips.push({ id: conflict.relPath, kind: 'note', reasonCode: 'tree_swap_local_first' })
        }
        resources.push({
          kind: 'notes-tree-swap',
          rootPath: toRel(notesRoot),
          stagingPath: toRel(mergedDir),
          livePath: toRel(notesRoot),
          asideTreePath: toRel(asideDir),
          treeHash: merged.treeHash
        })
        // Merge still imports an overlay only for declared backup paths (noteAdditions gate).
        for (const relPath of manifest.notes.paths) {
          noteAdditions.set(relPath, notesRoot)
        }
        counts.note += manifest.notes.paths.length
      } else {
        for (const relPath of manifest.notes.paths) {
          if (relPath.split(/[/\\]/).includes('..')) {
            archiveCorrupt(`note relPath contains '..': ${relPath}`)
          }
          const stagingAbs = path.join(workDir, 'notes', relPath)
          assertStagingFile(stagingAbs)
          const liveAbs = path.join(notesRoot, relPath)
          if (!isPathInside(liveAbs, notesRoot) || !isPathInside(liveAbs, userData)) {
            skips.push({ id: relPath, kind: 'note', reasonCode: 'outside_user_data' })
            continue
          }
          if (existsSync(liveAbs)) {
            skips.push({ id: relPath, kind: 'note', reasonCode: 'target_exists' })
            continue
          }
          resources.push({
            kind: 'note-add' as const,
            stagingPath: toRel(stagingAbs),
            livePath: toRel(liveAbs)
          })
          noteAdditions.set(relPath, notesRoot)
          counts.note += 1
        }
      }
    }
  } finally {
    workDb?.close()
    backupDb?.close()
  }

  return {
    stagedFileEntryIds,
    skippedFileEntryIds,
    skippedKnowledgeBaseIds,
    skippedSkillFolderNames,
    resources,
    noteAdditions,
    toRestore: buildToRestore(counts),
    skips
  }
}
