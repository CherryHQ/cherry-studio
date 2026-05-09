/**
 * FileRefService — pure DB repository for the `file_ref` polymorphic table.
 *
 * Phase status: Phase 1b.1 lands the read methods (findByEntryId / findBySource);
 * mutation methods (create / createMany / cleanupBySource) remain stubs until
 * Phase 1b.2 (write path).
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
import { and, eq } from 'drizzle-orm'

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
}

const notImplemented = (op: string): never => {
  throw new Error(`fileRefService.${op}: not implemented (Phase 1a skeleton, lands in Phase 1b.2)`)
}

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

  async create(_values: CreateFileRefRow): Promise<FileRef> {
    return notImplemented('create')
  }

  async createMany(_values: readonly CreateFileRefRow[]): Promise<FileRef[]> {
    return notImplemented('createMany')
  }

  async cleanupBySource(_source: FileRefSourceKey): Promise<number> {
    return notImplemented('cleanupBySource')
  }

  async cleanupBySourceBatch(_sourceType: FileRefSourceType, _sourceIds: readonly string[]): Promise<number> {
    return notImplemented('cleanupBySourceBatch')
  }
}

export const fileRefService: FileRefService = new FileRefServiceImpl()
