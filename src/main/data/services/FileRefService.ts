/**
 * FileRefService — pure DB repository for the `file_ref` polymorphic table.
 *
 * Phase status: Phase 1b.2 lands all read + mutation methods.
 *
 * ## Scope
 *
 * - **Pure DB.** Queries and mutations only; no dangling / orphan awareness.
 *   OrphanRefScanner in Phase 1b.4 is a separate service that *uses* this one.
 * - **Polymorphic sourceType keying.** No FK constraint on `sourceId` (see
 *   file schema). Producers MUST pass a `FileRefSourceType` literal that
 *   appears in the central registry (`packages/shared/data/types/file/ref/index.ts`);
 *   schema variants for non-`temp_session` sourceTypes are registered
 *   incrementally in Phase 1b.2.
 *
 * ## Pull-model cleanup
 *
 * `cleanupBySource(sourceType, sourceId)` is the canonical delete hook —
 * business delete flows (ChatService, KnowledgeItemService, etc.) call it
 * when the source entity is removed. OrphanRefScanner (Phase 1b.4) is the
 * belt-and-suspenders safety net for missed paths.
 */

import { application } from '@application'
import { fileRefTable } from '@data/db/schemas/file'
import type { FileEntryId, FileRef, FileRefSourceType } from '@shared/data/types/file'
import { FileRefSchema } from '@shared/data/types/file'
import { and, eq, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export interface FileRefSourceKey {
  readonly sourceType: FileRefSourceType
  readonly sourceId: string
}

export interface CreateFileRefRow extends FileRefSourceKey {
  readonly fileEntryId: FileEntryId
  readonly role: string
}

export interface FileRefService {
  /** All refs pointing at a given file_entry. Respects CASCADE — deleted entries return `[]`. */
  findByEntryId(fileEntryId: FileEntryId): Promise<FileRef[]>

  /** All refs owned by a business source (chat message, knowledge item, …). */
  findBySource(source: FileRefSourceKey): Promise<FileRef[]>

  /**
   * Insert a new ref. Violating `file_ref_unique_idx` (same entry + source +
   * role) throws — callers SHOULD upsert by catching and re-querying, or use
   * `createMany` with on-conflict-ignore semantics.
   */
  create(values: CreateFileRefRow): Promise<FileRef>

  /** Batch variant. Rows that violate the uniqueness constraint are skipped. */
  createMany(values: readonly CreateFileRefRow[]): Promise<FileRef[]>

  /**
   * Pull-model cleanup: remove all refs owned by the given source. Called
   * when the business entity itself is deleted.
   */
  cleanupBySource(source: FileRefSourceKey): Promise<number>

  /** Batch variant of `cleanupBySource` — one `DELETE … IN (…)` per sourceType. */
  cleanupBySourceBatch(sourceType: FileRefSourceType, sourceIds: readonly string[]): Promise<number>

  /**
   * Distinct `sourceId` values currently held by refs of the given sourceType.
   * Backs OrphanRefScanner — the only consumer.
   */
  listDistinctSourceIds(sourceType: FileRefSourceType): Promise<string[]>
}

/**
 * SQLite parameter cap is configurable but defaults to 999; keep batches well
 * under that for `inArray()` even with comparison overhead. Same constant lives
 * in `FileRefCheckerRegistry.knowledgeItemChecker` — kept lexically separate
 * because the two callers can diverge as their query shapes evolve.
 */
const SQLITE_INARRAY_CHUNK = 500

type FileRefRow = typeof fileRefTable.$inferSelect

function rowToFileRef(row: FileRefRow): FileRef {
  return FileRefSchema.parse(row)
}

class FileRefServiceImpl implements FileRefService {
  private getDb() {
    return application.get('DbService').getDb()
  }

  async findByEntryId(fileEntryId: FileEntryId): Promise<FileRef[]> {
    const rows = await this.getDb().select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, fileEntryId))
    return rows.map(rowToFileRef)
  }

  async findBySource(source: FileRefSourceKey): Promise<FileRef[]> {
    const rows = await this.getDb()
      .select()
      .from(fileRefTable)
      .where(and(eq(fileRefTable.sourceType, source.sourceType), eq(fileRefTable.sourceId, source.sourceId)))
    return rows.map(rowToFileRef)
  }

  async create(values: CreateFileRefRow): Promise<FileRef> {
    const now = Date.now()
    const rows = await this.getDb()
      .insert(fileRefTable)
      .values({
        id: uuidv4(),
        fileEntryId: values.fileEntryId,
        sourceType: values.sourceType,
        sourceId: values.sourceId,
        role: values.role,
        createdAt: now,
        updatedAt: now
      })
      .returning()
    return rowToFileRef(rows[0])
  }

  async createMany(values: readonly CreateFileRefRow[]): Promise<FileRef[]> {
    if (values.length === 0) return []
    const now = Date.now()
    const rows = await this.getDb()
      .insert(fileRefTable)
      .values(
        values.map((v) => ({
          id: uuidv4(),
          fileEntryId: v.fileEntryId,
          sourceType: v.sourceType,
          sourceId: v.sourceId,
          role: v.role,
          createdAt: now,
          updatedAt: now
        }))
      )
      .onConflictDoNothing()
      .returning()
    return rows.map(rowToFileRef)
  }

  async cleanupBySource(source: FileRefSourceKey): Promise<number> {
    const rows = await this.getDb()
      .delete(fileRefTable)
      .where(and(eq(fileRefTable.sourceType, source.sourceType), eq(fileRefTable.sourceId, source.sourceId)))
      .returning({ id: fileRefTable.id })
    return rows.length
  }

  async cleanupBySourceBatch(sourceType: FileRefSourceType, sourceIds: readonly string[]): Promise<number> {
    if (sourceIds.length === 0) return 0
    let total = 0
    // SQLite caps `IN (?, ?, …)` at SQLITE_LIMIT_VARIABLE_NUMBER (default 999;
    // sometimes 32766). Chunk so a long-tenured user with thousands of
    // orphaned source ids doesn't blow up the single-statement DELETE.
    for (let i = 0; i < sourceIds.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = sourceIds.slice(i, i + SQLITE_INARRAY_CHUNK)
      const rows = await this.getDb()
        .delete(fileRefTable)
        .where(and(eq(fileRefTable.sourceType, sourceType), inArray(fileRefTable.sourceId, chunk)))
        .returning({ id: fileRefTable.id })
      total += rows.length
    }
    return total
  }

  async listDistinctSourceIds(sourceType: FileRefSourceType): Promise<string[]> {
    const rows = await this.getDb()
      .selectDistinct({ sourceId: fileRefTable.sourceId })
      .from(fileRefTable)
      .where(eq(fileRefTable.sourceType, sourceType))
    return rows.map((r) => r.sourceId)
  }
}

export const fileRefService: FileRefService = new FileRefServiceImpl()
