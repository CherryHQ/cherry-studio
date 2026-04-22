/**
 * FileRefService — pure DB repository for the `file_ref` polymorphic table.
 *
 * Phase status: Phase 1a exports the **interface only**. Concrete Drizzle-backed
 * implementation lands in Phase 1b.1 (queries) and 1b.2 (mutations);
 * `cleanupBySource` is load-bearing for business services and is covered by
 * Phase 1b.2 write path.
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

import type { FileEntryId, FileRef, FileRefSourceType } from '@shared/data/types/file'

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
  throw new Error(`fileRefService.${op}: not implemented (Phase 1a skeleton, lands in Phase 1b.1/1b.2)`)
}

export const fileRefService: FileRefService = {
  findByEntryId: () => notImplemented('findByEntryId'),
  findBySource: () => notImplemented('findBySource'),
  create: () => notImplemented('create'),
  createMany: () => notImplemented('createMany'),
  cleanupBySource: () => notImplemented('cleanupBySource'),
  cleanupBySourceBatch: () => notImplemented('cleanupBySourceBatch')
}
