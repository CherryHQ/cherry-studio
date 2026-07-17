// Pre-merge file-resource staging from an admitted archive tree.
//
// Coordinator-owned (staging spec): scans workDir for files/knowledge/skills/notes
// payloads declared in resourceMetadata, seals eligible candidates under the
// restore work tree, and returns ID-keyed candidates + skippedFileEntryIds for
// merge. Does NOT implement contributor restoreResources (paper contract only).
//
// MVP additive kinds: blob-add / dir-add / note-add. External-path rewrite+dedup
// and notes dir-swap are deferred — external file_entry rows are skipped.

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file'
import Database from 'better-sqlite3'

import type { ArchiveContext } from './admitArchive'
import { sealDirectoryResource, sealFileResource } from './restoreResourceSeal'

const logger = loggerService.withContext('backup/buildFileResourcesFromAdmit')

export type StagedResourceKind = 'blob-add' | 'dir-add' | 'note-add'

/** Per-file_entry (or resource-key) candidate retained until post-merge finalize. */
export interface StagedFileCandidate {
  readonly stagedPath: string
  readonly livePath: string
  readonly ext: string | null
  readonly kind: StagedResourceKind
  readonly rewrite: {
    readonly origin: 'internal'
    readonly externalPath: null
    readonly size: number
  }
}

export interface PreMergeFileStaging {
  readonly candidates: ReadonlyMap<string, StagedFileCandidate>
  readonly skippedFileEntryIds: ReadonlySet<string>
}

/** Absolute live roots used to derive userData-relative journal livePath values. */
export interface RestorePathRoots {
  readonly userData: string
  readonly filesLiveRoot: string
  readonly knowledgeLiveRoot: string
  readonly skillsLiveRoot: string
  readonly notesLiveRoot: string
}

export class RestoreStagingPathEscapeError extends Error {
  constructor(detail: string) {
    super(`restore staging path escape: ${detail}`)
    this.name = 'RestoreStagingPathEscapeError'
  }
}

/**
 * Build pre-merge staging candidates from an admitted archive work directory.
 * Writes only under `workDir` (never live userData paths). Path escapes throw.
 */
export function buildFileResourcesFromAdmit(
  workDir: string,
  resourceMetadata: ArchiveContext['resourceMetadata'],
  pathRoots: RestorePathRoots
): PreMergeFileStaging {
  const candidates = new Map<string, StagedFileCandidate>()
  const skippedFileEntryIds = new Set<string>()
  const workRoot = path.resolve(workDir)
  const userData = path.resolve(pathRoots.userData)

  const fileMeta = readFileEntryMeta(path.join(workRoot, 'backup.sqlite'), resourceMetadata.fileIds)

  for (const fileId of resourceMetadata.fileIds) {
    assertSafeResourceSegment(fileId, 'file id')
    const payloadAbs = assertInsideWork(workRoot, path.join(workRoot, 'files', fileId))

    const meta = fileMeta.get(fileId)
    // External rows: MVP defers rewrite/dedup — skip owning file_entry + cascade refs.
    if (meta?.origin === 'external') {
      skippedFileEntryIds.add(fileId)
      logger.info('staging: external file_entry deferred (no rewrite in MVP)', { fileId })
      continue
    }

    if (!fs.existsSync(payloadAbs) || !fs.statSync(payloadAbs).isFile()) {
      skippedFileEntryIds.add(fileId)
      logger.info('staging: missing blob skipped', { fileId })
      continue
    }

    // Seal in place under the admit tree (tmp → fsync → rename → leaf-up dir fsync).
    sealFileResource(payloadAbs, payloadAbs, { stopDir: workRoot })

    const ext = meta?.ext ?? null
    const size = meta?.size ?? fs.statSync(payloadAbs).size
    const liveAbs = path.join(pathRoots.filesLiveRoot, ext ? `${fileId}.${ext}` : fileId)
    candidates.set(fileId, {
      stagedPath: toUserDataRelative(userData, payloadAbs),
      livePath: toUserDataRelative(userData, liveAbs),
      ext,
      kind: 'blob-add',
      rewrite: { origin: 'internal', externalPath: null, size }
    })
  }

  for (const baseId of resourceMetadata.knowledgeBases) {
    assertSafeResourceSegment(baseId, 'knowledge base id')
    const dirAbs = assertInsideWork(workRoot, path.join(workRoot, 'knowledge', baseId))
    if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
      logger.info('staging: missing knowledge dir skipped', { baseId })
      continue
    }
    sealDirectoryResource(dirAbs, dirAbs, { stopDir: workRoot })
    const liveAbs = path.join(pathRoots.knowledgeLiveRoot, baseId)
    candidates.set(`knowledge:${baseId}`, {
      stagedPath: toUserDataRelative(userData, dirAbs),
      livePath: toUserDataRelative(userData, liveAbs),
      ext: null,
      kind: 'dir-add',
      rewrite: { origin: 'internal', externalPath: null, size: directoryByteSize(dirAbs) }
    })
  }

  for (const skill of resourceMetadata.skillFolders) {
    assertSafeResourceSegment(skill.folderName, 'skill folder')
    const dirAbs = assertInsideWork(workRoot, path.join(workRoot, 'skills', skill.folderName))
    if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
      logger.info('staging: missing skill dir skipped', { folderName: skill.folderName })
      continue
    }
    sealDirectoryResource(dirAbs, dirAbs, { stopDir: workRoot })
    const liveAbs = path.join(pathRoots.skillsLiveRoot, skill.folderName)
    candidates.set(`skills:${skill.folderName}`, {
      stagedPath: toUserDataRelative(userData, dirAbs),
      livePath: toUserDataRelative(userData, liveAbs),
      ext: null,
      kind: 'dir-add',
      rewrite: { origin: 'internal', externalPath: null, size: directoryByteSize(dirAbs) }
    })
  }

  // Notes MVP: additive note-add only (full near-atomic dir-swap deferred).
  for (const rel of resourceMetadata.notePaths) {
    assertSafeNoteRel(rel)
    const noteAbs = assertInsideWork(workRoot, path.join(workRoot, 'notes', rel))
    if (!fs.existsSync(noteAbs) || !fs.statSync(noteAbs).isFile()) {
      logger.info('staging: missing note skipped', { rel })
      continue
    }
    sealFileResource(noteAbs, noteAbs, { stopDir: workRoot })
    const liveAbs = path.join(pathRoots.notesLiveRoot, rel)
    // Containment against the configured notes live root (lexical).
    if (
      !isPathInside(liveAbs, pathRoots.notesLiveRoot) &&
      path.resolve(liveAbs) !== path.resolve(pathRoots.notesLiveRoot)
    ) {
      throw new RestoreStagingPathEscapeError(`note live path escapes notes root: ${rel}`)
    }
    candidates.set(`notes:${rel}`, {
      stagedPath: toUserDataRelative(userData, noteAbs),
      livePath: toUserDataRelative(userData, liveAbs),
      ext: null,
      kind: 'note-add',
      rewrite: { origin: 'internal', externalPath: null, size: fs.statSync(noteAbs).size }
    })
  }

  return { candidates, skippedFileEntryIds }
}

/** Convert accepted candidates into journal fileResources entries (MVP: all candidates). */
export function candidatesToFileResources(
  staging: PreMergeFileStaging
): Array<{ kind: StagedResourceKind; stagingPath: string; livePath: string }> {
  return [...staging.candidates.values()].map((c) => ({
    kind: c.kind,
    stagingPath: c.stagedPath,
    livePath: c.livePath
  }))
}

/** Extract FILE_STORAGE rewrite metadata keyed by file_entry id (blob-add only). */
export function fileEntryRewritesFromStaging(
  staging: PreMergeFileStaging
): ReadonlyMap<string, StagedFileCandidate['rewrite']> {
  const out = new Map<string, StagedFileCandidate['rewrite']>()
  for (const [key, candidate] of staging.candidates) {
    if (candidate.kind === 'blob-add') out.set(key, candidate.rewrite)
  }
  return out
}

interface FileEntryMeta {
  readonly origin: 'internal' | 'external'
  readonly ext: string | null
  readonly size: number | null
}

function readFileEntryMeta(backupDbPath: string, fileIds: readonly string[]): Map<string, FileEntryMeta> {
  const out = new Map<string, FileEntryMeta>()
  if (fileIds.length === 0 || !fs.existsSync(backupDbPath)) return out

  const db = new Database(backupDbPath, { readonly: true })
  try {
    const stmt = db.prepare(`SELECT id, origin, ext, size FROM file_entry WHERE id = ? AND deleted_at IS NULL`)
    for (const id of fileIds) {
      const row = stmt.get(id) as { id: string; origin: string; ext: string | null; size: number | null } | undefined
      if (!row) continue
      if (row.origin !== 'internal' && row.origin !== 'external') continue
      out.set(id, { origin: row.origin, ext: row.ext, size: row.size })
    }
  } finally {
    db.close()
  }
  return out
}

function assertSafeResourceSegment(segment: string, label: string): void {
  if (!segment || segment.includes('\0') || segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
    throw new RestoreStagingPathEscapeError(`unsafe ${label}: ${segment}`)
  }
}

function assertSafeNoteRel(rel: string): void {
  if (!rel || rel.includes('\0') || rel.split(/[/\\]/).includes('..') || path.isAbsolute(rel)) {
    throw new RestoreStagingPathEscapeError(`unsafe note path: ${rel}`)
  }
}

function assertInsideWork(workRoot: string, candidate: string): string {
  const resolved = path.resolve(candidate)
  if (resolved !== workRoot && !isPathInside(resolved, workRoot)) {
    throw new RestoreStagingPathEscapeError(resolved)
  }
  return resolved
}

function toUserDataRelative(userData: string, absolute: string): string {
  const rel = path.relative(userData, absolute)
  if (path.isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
    throw new RestoreStagingPathEscapeError(`path not under userData: ${absolute}`)
  }
  return rel.split(path.sep).join('/')
}

function directoryByteSize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += directoryByteSize(full)
    else if (entry.isFile()) total += fs.statSync(full).size
  }
  return total
}
