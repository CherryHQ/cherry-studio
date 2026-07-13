import fs from 'node:fs'
import path from 'node:path'

import type { FileEntryRewrite } from '@main/data/db/backup/contributorTypes'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import type { RestoreJournal } from '@main/data/db/restore/restoreJournal'
import Database from 'better-sqlite3'

import type { ArchiveContext } from './admitArchive'
import type { MergeResult } from './merge'

/** Candidate retained between pre-merge staging and post-merge finalization. */
export interface StagedFileResourceCandidate {
  readonly stagedPath: string
  readonly kind: 'blob-add'
  readonly livePath: string
  readonly ext: string | null
  readonly rewrite: FileEntryRewrite
}

/** Resource facts that must be available before the detached merge starts. */
export interface PreMergeFileResourceStage {
  readonly candidates: ReadonlyMap<string, StagedFileResourceCandidate>
  readonly skippedFileEntryIds: ReadonlySet<string>
}

export interface FileResourceStageOptions {
  readonly archive: ArchiveContext
  readonly backupRoot: string
  readonly liveFileRoot: string
}

export interface FileResourceFinalizeOptions {
  readonly candidates: ReadonlyMap<string, StagedFileResourceCandidate>
  readonly mergeResult: MergeResult
  readonly userData: string
}

/** Dispatch FILE_STORAGE resource staging, then derive merge-ready candidates from its result. */
export async function stageFileResources(options: FileResourceStageOptions): Promise<PreMergeFileResourceStage> {
  const { archive, backupRoot, liveFileRoot } = options
  const candidates = new Map<string, StagedFileResourceCandidate>()
  const skippedFileEntryIds = new Set<string>()
  const archiveRoot = path.dirname(archive.backupDbPath)
  const archiveFilesRoot = path.join(archiveRoot, 'files')

  const db = new Database(archive.backupDbPath, { readonly: true })
  let selectedRows: readonly BackupFileRow[]
  try {
    selectedRows = selectedFileRows(db, archive.domains)
  } finally {
    db.close()
  }

  if (!archive.includeFiles) {
    if (selectedRows.length > 0 || archive.resourceMetadata.fileIds.length > 0 || hasPayload(archiveFilesRoot)) {
      throw new Error('restore resources declared by a lite archive')
    }
    return { candidates, skippedFileEntryIds }
  }

  const selectedIds = new Set(selectedRows.map((row) => row.id))
  const restoreResources = contributorManager.getRegistry().getOperations('FILE_STORAGE')?.restoreResources
  if (!restoreResources) {
    throw new Error('FILE_STORAGE contributor does not implement restoreResources')
  }
  const result = await restoreResources({
    registry: contributorManager.getRegistry(),
    restoreId: path.basename(path.dirname(backupRoot)),
    domains: archive.domains,
    strategy: 'SKIP',
    archiveRoot,
    backupRoot,
    liveFileRoot,
    filesAffected: selectedIds
  })
  const manifestIds = new Set(archive.resourceMetadata.fileIds)

  for (const row of selectedRows) {
    if (!isSafeFileId(row.id)) {
      skippedFileEntryIds.add(row.id)
      continue
    }
    const stagedPath = path.join(backupRoot, 'files', row.id)
    const livePath = resolveLivePath(liveFileRoot, row.id, row.ext)
    // Metadata and payload identities must agree even if the contributor restored bytes.
    if (
      !manifestIds.has(row.id) ||
      !result.restoredFileIds.has(row.id) ||
      !safePayloadPath(archiveFilesRoot, row.id) ||
      !livePath
    ) {
      skippedFileEntryIds.add(row.id)
      fs.rmSync(stagedPath, { force: true })
      continue
    }
    const size = fs.statSync(stagedPath).size
    candidates.set(row.id, {
      stagedPath,
      kind: 'blob-add',
      livePath,
      ext: row.ext,
      rewrite: { origin: 'internal', externalPath: null, size }
    })
  }

  for (const id of result.skippedFileIds) skippedFileEntryIds.add(id)
  return { candidates, skippedFileEntryIds }
}

/** Convert merge evidence into promotion-safe blob-add journal entries. */
export function finalizeFileResources(options: FileResourceFinalizeOptions): RestoreJournal['fileResources'] {
  const resources: RestoreJournal['fileResources'] = []
  for (const [fileEntryId, candidate] of options.candidates) {
    const accepted = options.mergeResult.acceptedFileEntryIds.includes(fileEntryId)
    const survivor = options.mergeResult.survivingFileEntries.get(fileEntryId)
    const newlyReferenced = options.mergeResult.acceptedFileRefFileEntryIds.includes(fileEntryId)

    if (accepted) {
      const liveTarget = inspectExistingLiveTarget(path.dirname(candidate.livePath), candidate.livePath)
      if (liveTarget === 'unsafe') {
        throw new Error(`restore resource add target is unsafe: ${candidate.livePath}`)
      }
      if (liveTarget === 'file') {
        // Recheck immediately before journaling in case a live orphan appeared during merge.
        if (!sameFileContents(candidate.stagedPath, candidate.livePath)) {
          throw new Error(`restore resource add target conflicts with staged blob: ${candidate.livePath}`)
        }
        removeCandidate(candidate)
        continue
      }
      resources.push(toJournalResource(candidate, options.userData))
      continue
    }

    if (!survivor || survivor.origin !== 'internal' || survivor.deletedAt !== null) {
      removeCandidate(candidate)
      continue
    }

    const liveRoot = path.dirname(candidate.livePath)
    if (!newlyReferenced) {
      removeCandidate(candidate)
      continue
    }
    const survivorLivePath = resolveLivePath(liveRoot, fileEntryId, survivor.ext)
    if (!survivorLivePath) {
      throw new Error(`restore resource survivor path is unsafe: ${fileEntryId}`)
    }
    const survivorTarget = inspectExistingLiveTarget(liveRoot, survivorLivePath)
    if (survivorTarget === 'unsafe') {
      throw new Error(`restore resource survivor target is unsafe: ${survivorLivePath}`)
    }
    if (survivorTarget === 'file') {
      removeCandidate(candidate)
      continue
    }

    resources.push(toJournalResource({ ...candidate, livePath: survivorLivePath, ext: survivor.ext }, options.userData))
  }
  return resources
}

interface BackupFileRow {
  readonly id: string
  readonly ext: string | null
}

/** Select file_entry roots required by FILE_STORAGE and source-domain file references. */
function selectedFileRows(db: Database.Database, domains: readonly string[]): readonly BackupFileRow[] {
  const selected = new Map<string, BackupFileRow>()
  const addRows = (sql: string): void => {
    for (const row of db.prepare(sql).all() as BackupFileRow[]) selected.set(row.id, row)
  }
  if (domains.includes('FILE_STORAGE')) addRows('SELECT id, ext FROM file_entry WHERE deleted_at IS NULL')
  if (domains.includes('TOPICS')) {
    addRows(
      `SELECT f.id, f.ext FROM file_entry f INNER JOIN chat_message_file_ref r ON r.file_entry_id = f.id WHERE f.deleted_at IS NULL`
    )
  }
  if (domains.includes('PAINTINGS')) {
    addRows(
      `SELECT f.id, f.ext FROM file_entry f INNER JOIN painting_file_ref r ON r.file_entry_id = f.id WHERE f.deleted_at IS NULL`
    )
  }
  return [...selected.values()]
}

/** Archive file resource identifiers are flat filenames, never paths. */
function isSafeFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/** Build a flat managed blob path without trusting archive extension text as a path. */
function resolveLivePath(liveFileRoot: string, id: string, ext: string | null): string | undefined {
  if (!isSafeFileId(id) || !isSafeFileExtension(ext)) return undefined
  const root = path.resolve(liveFileRoot)
  const filename = ext === null ? id : `${id}.${ext}`
  const target = path.resolve(root, filename)
  return isContained(root, target) ? target : undefined
}

/** File extensions are metadata, but managed blobs are always flat filenames. */
function isSafeFileExtension(ext: string | null): boolean {
  return ext === null || (typeof ext === 'string' && ext.length > 0 && !/[\\/\\u0000]/.test(ext))
}

/** Classify an existing target without following a symlink outside the managed root. */
function inspectExistingLiveTarget(liveRoot: string, target: string): 'missing' | 'file' | 'unsafe' {
  try {
    if (!isContained(path.resolve(liveRoot), path.resolve(target))) return 'unsafe'
    const targetStat = fs.lstatSync(target)
    if (!targetStat.isFile()) return 'unsafe'
    const realRoot = fs.realpathSync(liveRoot)
    const realTarget = fs.realpathSync(target)
    return isContained(realRoot, realTarget) ? 'file' : 'unsafe'
  } catch (error) {
    return isFileNotFoundError(error) ? 'missing' : 'unsafe'
  }
}

/** Distinguish an absent target from permission and filesystem integrity failures. */
function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Resolve a payload only when lexical and realpath containment both hold. */
function safePayloadPath(filesRoot: string, id: string): string | undefined {
  if (!isSafeFileId(id)) return undefined
  const root = path.resolve(filesRoot)
  const candidate = path.resolve(root, id)
  if (!isContained(root, candidate) || !fs.existsSync(candidate)) return undefined
  try {
    const realRoot = fs.realpathSync(root)
    const realCandidate = fs.realpathSync(candidate)
    if (!isContained(realRoot, realCandidate) || !fs.statSync(realCandidate).isFile()) return undefined
    return realCandidate
  } catch {
    return undefined
  }
}

function hasPayload(filesRoot: string): boolean {
  try {
    return fs.readdirSync(filesRoot).length > 0
  } catch {
    return false
  }
}

/** Compare sealed files incrementally to keep memory bounded for large attachments. */
function sameFileContents(firstPath: string, secondPath: string): boolean {
  let firstFd: number | undefined
  let secondFd: number | undefined
  try {
    const firstSize = fs.statSync(firstPath).size
    if (firstSize !== fs.statSync(secondPath).size) return false

    firstFd = fs.openSync(firstPath, 'r')
    secondFd = fs.openSync(secondPath, 'r')
    const firstChunk = Buffer.allocUnsafe(64 * 1024)
    const secondChunk = Buffer.allocUnsafe(64 * 1024)
    let compared = 0
    while (compared < firstSize) {
      const length = Math.min(firstChunk.byteLength, firstSize - compared)
      const firstRead = fs.readSync(firstFd, firstChunk, 0, length, compared)
      const secondRead = fs.readSync(secondFd, secondChunk, 0, length, compared)
      if (firstRead !== secondRead || firstRead === 0) return false
      if (!firstChunk.subarray(0, firstRead).equals(secondChunk.subarray(0, secondRead))) return false
      compared += firstRead
    }
    return true
  } catch {
    return false
  } finally {
    if (firstFd !== undefined) fs.closeSync(firstFd)
    if (secondFd !== undefined) fs.closeSync(secondFd)
  }
}

function removeCandidate(candidate: StagedFileResourceCandidate): void {
  fs.rmSync(candidate.stagedPath, { force: true })
}

function toJournalResource(
  candidate: StagedFileResourceCandidate,
  userData: string
): RestoreJournal['fileResources'][number] {
  const stagingPath = relativeContainedPath(userData, candidate.stagedPath)
  const livePath = relativeContainedPath(userData, candidate.livePath)
  return {
    kind: candidate.kind,
    stagingPath,
    livePath
  }
}

/** Restore journal paths are always relative to and contained by userData. */
function relativeContainedPath(userData: string, target: string): string {
  const relativePath = path.relative(path.resolve(userData), path.resolve(target))
  if (
    relativePath === '' ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`restore resource path escapes userData: ${target}`)
  }
  return relativePath
}

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`)
}
