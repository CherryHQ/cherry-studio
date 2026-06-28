/**
 * FileRefService — read facade + temp-session ref store.
 *
 * Persistent business refs are owned by their source domains and stored in
 * FK-constrained association tables (`chat_message_file_ref`,
 * `painting_file_ref`). This service does not create, copy, or replace those
 * persistent relationships; source services/migrators write their own tables.
 *
 * Cross-source read aggregation still lives here because File DataApi and the
 * file sweep need a unified FileRef projection. `temp_session` refs are the
 * only mutable refs owned here: they are stored in main-process CacheService
 * memory and intentionally disappear on restart.
 */

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@data/db/schemas/fileRelations'
import type { FileEntryId, FileRef, FileRefSourceType } from '@shared/data/types/file'
import { FileRefSchema } from '@shared/data/types/file'
import { chatMessageSourceType, paintingSourceType, tempSessionSourceType } from '@shared/data/types/file/ref'
import { asc, count, eq, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export interface FileRefSourceKey {
  readonly sourceType: FileRefSourceType
  readonly sourceId: string
}

export interface CreateTempSessionFileRefRow {
  readonly fileEntryId: FileEntryId
  readonly sourceId: string
  readonly role: string
}

export interface FileRefService {
  /** All refs pointing at a given file_entry. Includes CacheService-backed temp-session refs. */
  findByEntryId(fileEntryId: FileEntryId): Promise<FileRef[]>

  /** All refs owned by a business source (chat message, painting, temp session). */
  findBySource(source: FileRefSourceKey): Promise<FileRef[]>

  /** Add one in-memory temp-session ref. Duplicate `(entry, source, role)` throws. */
  createTempSessionRef(values: CreateTempSessionFileRefRow): Promise<FileRef>

  /** Batch add in-memory temp-session refs. Duplicate `(entry, source, role)` rows are skipped. */
  createManyTempSessionRefs(values: readonly CreateTempSessionFileRefRow[]): Promise<FileRef[]>

  /** Remove all temp-session refs owned by one source id. */
  cleanupTempSessionSource(sourceId: string): Promise<number>

  /** Remove all temp-session refs owned by the given source ids. */
  cleanupTempSessionSources(sourceIds: readonly string[]): Promise<number>

  /** Ref-count aggregation for a batch of entry ids. */
  countByEntryIds(ids: readonly FileEntryId[]): Promise<Map<FileEntryId, number>>

  /** Drop temp-session cache refs whose file_entry no longer exists. */
  pruneMissingTempSessionRefs(existingEntryIds: ReadonlySet<FileEntryId>): Promise<number>
}

const SQLITE_INARRAY_CHUNK = 500
const TEMP_SESSION_REFS_CACHE_KEY = 'file.temp_session.refs'

type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
type PaintingFileRefRow = typeof paintingFileRefTable.$inferSelect
type TempSessionFileRef = Extract<FileRef, { sourceType: typeof tempSessionSourceType }>
type TempSessionRefCache = Record<string, TempSessionFileRef[]>

function compareRefs(left: FileRef, right: FileRef): number {
  const createdDelta = left.createdAt - right.createdAt
  if (createdDelta !== 0) return createdDelta
  return left.id.localeCompare(right.id)
}

function chatMessageRowToFileRef(row: ChatMessageFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: chatMessageSourceType })
}

function paintingRowToFileRef(row: PaintingFileRefRow): FileRef {
  return FileRefSchema.parse({ ...row, sourceType: paintingSourceType })
}

function tempSessionRowToFileRef(row: TempSessionFileRef): FileRef {
  return FileRefSchema.parse(row)
}

function isDuplicateTempRef(left: CreateTempSessionFileRefRow, right: FileRef): boolean {
  return left.fileEntryId === right.fileEntryId && left.sourceId === right.sourceId && left.role === right.role
}

class FileRefServiceImpl implements FileRefService {
  private getDbService() {
    return application.get('DbService')
  }

  private getDb() {
    return this.getDbService().getDb()
  }

  private getCacheService() {
    return application.get('CacheService')
  }

  private readTempSessionCache(): TempSessionRefCache {
    const cache = this.getCacheService().get<TempSessionRefCache>(TEMP_SESSION_REFS_CACHE_KEY) ?? {}
    return Object.fromEntries(
      Object.entries(cache).map(([sourceId, refs]) => [sourceId, refs.map((ref) => ({ ...ref }))])
    )
  }

  private writeTempSessionCache(cache: TempSessionRefCache): void {
    if (Object.keys(cache).length === 0) {
      this.getCacheService().delete(TEMP_SESSION_REFS_CACHE_KEY)
      return
    }
    this.getCacheService().set(TEMP_SESSION_REFS_CACHE_KEY, cache)
  }

  async findByEntryId(fileEntryId: FileEntryId): Promise<FileRef[]> {
    const [chatRows, paintingRows] = await Promise.all([
      this.getDb()
        .select()
        .from(chatMessageFileRefTable)
        .where(eq(chatMessageFileRefTable.fileEntryId, fileEntryId))
        .orderBy(asc(chatMessageFileRefTable.createdAt), asc(chatMessageFileRefTable.id)),
      this.getDb()
        .select()
        .from(paintingFileRefTable)
        .where(eq(paintingFileRefTable.fileEntryId, fileEntryId))
        .orderBy(asc(paintingFileRefTable.createdAt), asc(paintingFileRefTable.id))
    ])

    const tempRefs = Object.values(this.readTempSessionCache())
      .flat()
      .filter((ref) => ref.fileEntryId === fileEntryId)
      .map(tempSessionRowToFileRef)

    return [...chatRows.map(chatMessageRowToFileRef), ...paintingRows.map(paintingRowToFileRef), ...tempRefs].sort(
      compareRefs
    )
  }

  async findBySource(source: FileRefSourceKey): Promise<FileRef[]> {
    switch (source.sourceType) {
      case tempSessionSourceType:
        return (this.readTempSessionCache()[source.sourceId] ?? []).map(tempSessionRowToFileRef).sort(compareRefs)
      case chatMessageSourceType: {
        const rows = await this.getDb()
          .select()
          .from(chatMessageFileRefTable)
          .where(eq(chatMessageFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(chatMessageFileRefTable.createdAt), asc(chatMessageFileRefTable.id))
        return rows.map(chatMessageRowToFileRef)
      }
      case paintingSourceType: {
        const rows = await this.getDb()
          .select()
          .from(paintingFileRefTable)
          .where(eq(paintingFileRefTable.sourceId, source.sourceId))
          .orderBy(asc(paintingFileRefTable.createdAt), asc(paintingFileRefTable.id))
        return rows.map(paintingRowToFileRef)
      }
    }
  }

  async createTempSessionRef(values: CreateTempSessionFileRefRow): Promise<FileRef> {
    const inserted = await this.createTempSessionRefs([values], { throwOnDuplicate: true })
    return inserted[0]
  }

  async createManyTempSessionRefs(values: readonly CreateTempSessionFileRefRow[]): Promise<FileRef[]> {
    return this.createTempSessionRefs(values)
  }

  async cleanupTempSessionSource(sourceId: string): Promise<number> {
    const cache = this.readTempSessionCache()
    const removed = cache[sourceId]?.length ?? 0
    if (removed === 0) return 0
    delete cache[sourceId]
    this.writeTempSessionCache(cache)
    return removed
  }

  async cleanupTempSessionSources(sourceIds: readonly string[]): Promise<number> {
    let removed = 0
    for (const sourceId of sourceIds) {
      removed += await this.cleanupTempSessionSource(sourceId)
    }
    return removed
  }

  async countByEntryIds(ids: readonly FileEntryId[]): Promise<Map<FileEntryId, number>> {
    const counts = new Map<FileEntryId, number>()
    if (ids.length === 0) return counts

    const add = (entryId: FileEntryId, refCount: number) => {
      counts.set(entryId, (counts.get(entryId) ?? 0) + refCount)
    }

    for (let i = 0; i < ids.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = ids.slice(i, i + SQLITE_INARRAY_CHUNK)
      const [chatRows, paintingRows] = await Promise.all([
        this.getDb()
          .select({ entryId: chatMessageFileRefTable.fileEntryId, refCount: count() })
          .from(chatMessageFileRefTable)
          .where(inArray(chatMessageFileRefTable.fileEntryId, chunk))
          .groupBy(chatMessageFileRefTable.fileEntryId),
        this.getDb()
          .select({ entryId: paintingFileRefTable.fileEntryId, refCount: count() })
          .from(paintingFileRefTable)
          .where(inArray(paintingFileRefTable.fileEntryId, chunk))
          .groupBy(paintingFileRefTable.fileEntryId)
      ])
      for (const row of chatRows) add(row.entryId, row.refCount)
      for (const row of paintingRows) add(row.entryId, row.refCount)
    }

    const requested = new Set(ids)
    for (const ref of Object.values(this.readTempSessionCache()).flat()) {
      if (requested.has(ref.fileEntryId)) {
        add(ref.fileEntryId, 1)
      }
    }

    return counts
  }

  async pruneMissingTempSessionRefs(existingEntryIds: ReadonlySet<FileEntryId>): Promise<number> {
    const cache = this.readTempSessionCache()
    let removed = 0
    for (const [sourceId, refs] of Object.entries(cache)) {
      const kept = refs.filter((ref) => existingEntryIds.has(ref.fileEntryId))
      removed += refs.length - kept.length
      if (kept.length === 0) {
        delete cache[sourceId]
      } else {
        cache[sourceId] = kept
      }
    }
    if (removed > 0) {
      this.writeTempSessionCache(cache)
    }
    return removed
  }

  private async assertEntriesExist(entryIds: readonly FileEntryId[]): Promise<void> {
    const uniqueIds = [...new Set(entryIds)]
    if (uniqueIds.length === 0) return
    const existing = new Set<FileEntryId>()
    for (let i = 0; i < uniqueIds.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = uniqueIds.slice(i, i + SQLITE_INARRAY_CHUNK)
      const rows = await this.getDb()
        .select({ id: fileEntryTable.id })
        .from(fileEntryTable)
        .where(inArray(fileEntryTable.id, chunk))
      for (const row of rows) existing.add(row.id)
    }
    const missing = uniqueIds.find((id) => !existing.has(id))
    if (missing) {
      throw new Error(`FileEntry not found: ${missing}`)
    }
  }

  private async createTempSessionRefs(
    values: readonly CreateTempSessionFileRefRow[],
    options: { readonly throwOnDuplicate?: boolean } = {}
  ): Promise<FileRef[]> {
    if (values.length === 0) return []
    await this.assertEntriesExist(values.map((value) => value.fileEntryId))

    const cache = this.readTempSessionCache()
    const now = Date.now()
    const inserted: FileRef[] = []
    for (const value of values) {
      const refs = cache[value.sourceId] ?? []
      const duplicate = refs.some((ref) => isDuplicateTempRef(value, ref))
      if (duplicate) {
        if (options.throwOnDuplicate) {
          throw new Error('Duplicate temp_session file ref')
        }
        continue
      }
      const ref = FileRefSchema.parse({
        id: uuidv4(),
        fileEntryId: value.fileEntryId,
        sourceType: tempSessionSourceType,
        sourceId: value.sourceId,
        role: value.role,
        createdAt: now,
        updatedAt: now
      })
      refs.push(ref as TempSessionFileRef)
      cache[value.sourceId] = refs
      inserted.push(ref)
    }
    if (inserted.length > 0) {
      this.writeTempSessionCache(cache)
    }
    return inserted.sort(compareRefs)
  }
}

export const fileRefService: FileRefService = new FileRefServiceImpl()
