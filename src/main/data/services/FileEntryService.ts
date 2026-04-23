/**
 * FileEntryService — pure DB repository for the `file_entry` table.
 *
 * Phase status: Phase 1a exports the **interface only**. Concrete Drizzle-backed
 * implementation (including UUID v7 generation, Zod brand validation on every
 * returned row, and `findByExternalPath` canonical-key semantics) lands in
 * Phase 1b.1.
 *
 * ## Scope
 *
 * - **Pure DB.** No FS IO, no path resolution, no canonicalization. Callers
 *   (e.g. `FileManager.ensureExternalEntry`) are responsible for passing a
 *   canonical `externalPath` on write and query.
 * - **Produces branded `FileEntry`.** Every returned row MUST pass
 *   `FileEntrySchema.parse()` so the brand contract holds — downstream
 *   consumers cannot receive a raw object literal that satisfies the shape
 *   but bypasses validation (RFC §4.5.2 runtime brand contract).
 * - **No side effects beyond DB.** Dangling updates, watcher invalidation,
 *   and cache invalidation are orchestrated by FileManager — this service
 *   is strictly query/insert/update/delete.
 *
 * See [architecture.md](../../../docs/references/file/architecture.md#11) and
 * RFC §9.3 for the Phase 1b.1 deliverables.
 */

import type { FileEntry, FileEntryId, FileEntryOrigin } from '@shared/data/types/file'

/** Columns a caller may provide on insert (id defaults to a fresh UUID v7 when omitted). */
export interface CreateFileEntryRow {
  readonly id?: FileEntryId
  readonly origin: FileEntryOrigin
  readonly name: string
  readonly ext: string | null
  /**
   * Bytes. Non-null iff `origin === 'internal'` (authoritative for internal
   * files). Must be `null` for `origin === 'external'` — external rows carry
   * no stored size by design (enforced by `fe_size_internal_only` CHECK);
   * live values come from File IPC `getMetadata`.
   */
  readonly size: number | null
  /** Non-null iff `origin === 'external'`; must be pre-canonicalized. */
  readonly externalPath: string | null
  readonly trashedAt?: number | null
}

/**
 * Columns that may be mutated post-insert. Origin / id / externalPath are
 * immutable. Note `size` is included because internal-file writes update the
 * byte count atomically; on external rows it must remain `null`.
 */
export type UpdateFileEntryRow = Partial<Pick<CreateFileEntryRow, 'name' | 'ext' | 'size'>> & {
  readonly trashedAt?: number | null
}

export interface FindEntriesQuery {
  readonly origin?: FileEntryOrigin
  readonly inTrash?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface FileEntryService {
  /** Return the entry, or `null` if not found. Trashed entries are included. */
  findById(id: FileEntryId): Promise<FileEntry | null>

  /** Return the entry, or throw. Trashed entries are included. */
  getById(id: FileEntryId): Promise<FileEntry>

  /**
   * Look up an external entry by canonical `externalPath`. Returns `null` when
   * no row matches. Callers MUST pass the output of `canonicalizeExternalPath`
   * — raw user paths will not match.
   */
  findByExternalPath(canonicalPath: string): Promise<FileEntry | null>

  /** Flat listing. Trashed filter defaults to "active only" when `inTrash` is omitted. */
  findMany(query?: FindEntriesQuery): Promise<FileEntry[]>

  /** Insert a new row. Violates `fe_origin_consistency` / `fe_size_internal_only` → throws. */
  create(values: CreateFileEntryRow): Promise<FileEntry>

  /** Update mutable columns. Returns the refreshed row. Throws if not found. */
  update(id: FileEntryId, values: UpdateFileEntryRow): Promise<FileEntry>

  /** Remove the row (CASCADE drops dependent `file_ref`s). No-op if already gone. */
  delete(id: FileEntryId): Promise<void>
}

const notImplemented = (op: string): never => {
  throw new Error(`fileEntryService.${op}: not implemented (Phase 1a skeleton, lands in Phase 1b.1)`)
}

export const fileEntryService: FileEntryService = {
  findById: () => notImplemented('findById'),
  getById: () => notImplemented('getById'),
  findByExternalPath: () => notImplemented('findByExternalPath'),
  findMany: () => notImplemented('findMany'),
  create: () => notImplemented('create'),
  update: () => notImplemented('update'),
  delete: () => notImplemented('delete')
}
