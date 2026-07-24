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

import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'

import type { PathResolvableEntry } from '@main/services/file/utils/pathResolver'
import { resolvePhysicalPath } from '@main/services/file/utils/pathResolver'
import { isPathInside } from '@main/utils/file'
import { SafeNameSchema } from '@shared/data/types/file'
import type { ResourceClass } from '@shared/types/backup'
import Database from 'better-sqlite3'

import { BackupArchiveCorruptError } from './errors'
import type { BackupManifest } from './manifest'
import { presetIncludesFiles, resolvePreset } from './presets'

/** A file resource restricted to additive kinds (no overwrite/note-overwrite in this PR). */
export type AddFileResource = {
  readonly kind: 'blob-add' | 'dir-add' | 'note-add'
  readonly stagingPath: string
  readonly livePath: string
}

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

const EMPTY_PLAN: ResourcePlan = {
  stagedFileEntryIds: new Set(),
  skippedFileEntryIds: new Set(),
  skippedKnowledgeBaseIds: new Set(),
  skippedSkillFolderNames: new Set(),
  resources: [],
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

function archiveCorrupt(detail: string): never {
  throw new BackupArchiveCorruptError(detail)
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
  return { id: row.id, origin: 'internal', ext: row.ext }
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
  const resources: AddFileResource[] = []
  const skips: SkippedResource[] = []
  const counts: Record<ResourceClass, number> = { file: 0, knowledge: 0, skill: 0, note: 0 }

  const toRel = (abs: string): string => {
    const rel = path.relative(userData, abs)
    if (path.isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
      archiveCorrupt(`path escapes userData: ${abs}`)
    }
    return rel
  }

  const backupDb = new Database(backupDbPath, { readonly: true, fileMustExist: true })
  const workDb = new Database(workPath, { readonly: true, fileMustExist: true })
  try {
    // ── files ──
    for (const id of manifest.files.ids) {
      const row = backupDb.prepare('SELECT id, origin, ext, external_path FROM file_entry WHERE id = ?').get(id) as
        | FileEntrySqlRow
        | undefined
      if (!row || row.origin !== 'internal') {
        archiveCorrupt(`file ${id}: missing or external`)
      }
      const stagingAbs = path.join(workDir, 'files', id)
      assertStagingFile(stagingAbs)
      const liveAbs = resolvePhysicalPath(toPathResolvable(row))
      if (!isPathInside(liveAbs, roots.files)) {
        archiveCorrupt(`file ${id}: outside filesRoot`)
      }
      const localRow = workDb.prepare('SELECT 1 AS ok FROM file_entry WHERE id = ?').get(id)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id,
          kind: 'file',
          reason: localRow ? 'local DB row exists' : 'live exists'
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
      const backupRow = backupDb.prepare('SELECT 1 AS ok FROM knowledge_base WHERE id = ?').get(baseId)
      if (!backupRow) archiveCorrupt(`knowledge ${baseId}: missing from backup DB`)
      const stagingAbs = path.join(workDir, 'knowledge', baseId)
      assertStagingDir(stagingAbs)
      const liveAbs = path.join(roots.knowledge, baseId)
      if (!isPathInside(liveAbs, roots.knowledge)) {
        archiveCorrupt(`knowledge ${baseId}: outside knowledgeRoot`)
      }
      const localRow = workDb.prepare('SELECT 1 AS ok FROM knowledge_base WHERE id = ?').get(baseId)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id: baseId,
          kind: 'knowledge',
          reason: localRow ? 'local DB row exists' : 'live exists'
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
      const backupRow = backupDb
        .prepare('SELECT 1 AS ok FROM agent_global_skill WHERE folder_name = ?')
        .get(folderName)
      if (!backupRow) archiveCorrupt(`skill ${folderName}: missing from backup DB`)
      const stagingAbs = path.join(workDir, 'skills', folderName)
      assertStagingDir(stagingAbs)
      const liveAbs = path.join(roots.skills, folderName)
      if (!isPathInside(liveAbs, roots.skills)) {
        archiveCorrupt(`skill ${folderName}: outside skillsRoot`)
      }
      const localRow = workDb.prepare('SELECT 1 AS ok FROM agent_global_skill WHERE folder_name = ?').get(folderName)
      if (localRow || existsSync(liveAbs)) {
        skips.push({
          id: folderName,
          kind: 'skill',
          reason: localRow ? 'local DB row exists' : 'live exists'
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
        skips.push({ id: relPath, kind: 'note', reason: 'no managed notesRoot' })
      }
    } else if (notesRoot) {
      for (const relPath of manifest.notes.paths) {
        if (relPath.split(/[/\\]/).includes('..')) {
          archiveCorrupt(`note relPath contains '..': ${relPath}`)
        }
        const stagingAbs = path.join(workDir, 'notes', relPath)
        assertStagingFile(stagingAbs)
        const liveAbs = path.join(notesRoot, relPath)
        if (!isPathInside(liveAbs, notesRoot) || !isPathInside(liveAbs, userData)) {
          skips.push({ id: relPath, kind: 'note', reason: 'outside userData' })
          continue
        }
        if (existsSync(liveAbs)) {
          skips.push({ id: relPath, kind: 'note', reason: 'exists — skip' })
          continue
        }
        resources.push({
          kind: 'note-add' as const,
          stagingPath: toRel(stagingAbs),
          livePath: toRel(liveAbs)
        })
        counts.note += 1
      }
    }
  } finally {
    backupDb.close()
    workDb.close()
  }

  return {
    stagedFileEntryIds,
    skippedFileEntryIds,
    skippedKnowledgeBaseIds,
    skippedSkillFolderNames,
    resources,
    toRestore: buildToRestore(counts),
    skips
  }
}
