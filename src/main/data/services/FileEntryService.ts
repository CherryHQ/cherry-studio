/**
 * FileEntryService — pure DB repository for the `file_entry` table.
 *
 * ## Scope
 *
 * - **Pure DB.** No FS IO, no path resolution, no canonicalization. Callers
 *   (e.g. `FileManager.ensureExternalEntry`) are responsible for passing a
 *   canonical `externalPath` on write and query.
 * - **Produces branded `FileEntry`.** Every returned row passes
 *   `FileEntrySchema.parse()` so the brand contract holds — downstream
 *   consumers cannot receive a raw object literal that satisfies the shape
 *   but bypasses validation.
 * - **No side effects beyond DB.** Dangling updates, watcher invalidation,
 *   and cache invalidation are orchestrated by FileManager — this service
 *   is strictly query/insert/update/delete.
 *
 * See [architecture.md](../../../docs/references/file/architecture.md) for the
 * module-level layering rules.
 */

import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import type { CanonicalExternalPath, FileEntry, FileEntryId, FileEntryOrigin } from '@shared/data/types/file'
import { FileEntrySchema } from '@shared/data/types/file'
import { and, asc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

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
   * no row matches. The `CanonicalExternalPath` brand forces callers through
   * `canonicalizeExternalPath()` at compile time — raw `string` values are
   * not assignable here, which prevents the "caller forgot to canonicalize"
   * class of bug that would silently miss all matches.
   */
  findByExternalPath(canonicalPath: CanonicalExternalPath): Promise<FileEntry | null>

  /**
   * Return external entries whose `externalPath` matches `canonicalPath`
   * case-insensitively. Byte-exact matches are included; callers that only
   * want "suspect duplicates" (e.g. `ensureExternalEntry` on insert) should
   * filter the byte-exact self-match from the result.
   *
   * Intended for the duplicate-suspect `warn` logging contract in
   * `file-manager-architecture.md §1.2 Duplicate-entry detection on insert`.
   * Best-effort: callers are free to skip invoking this method when the
   * `file_entry` table size exceeds a sensible threshold (the service itself
   * does not gate on size — separation of concerns keeps the repository
   * dumb).
   */
  findCaseInsensitivePeers(canonicalPath: CanonicalExternalPath): Promise<FileEntry[]>

  /** Flat listing. Trashed filter defaults to "active only" when `inTrash` is omitted. */
  findMany(query?: FindEntriesQuery): Promise<FileEntry[]>

  /**
   * Active (non-trashed) entries with zero `file_ref` rows pointing at them.
   * Used by Phase 1b.4 OrphanRefScanner's report-only entry pass — see
   * file-manager-architecture §7.1 (default policy is "preserve").
   */
  findUnreferenced(query?: { origin?: FileEntryOrigin }): Promise<FileEntry[]>

  /**
   * All entry ids regardless of trashed state — backs the Phase 1b.4 startup
   * file sweep, which needs to know which on-disk UUID files have a DB row
   * (active or trashed; both are out of scope for unlink).
   */
  listAllIds(): Promise<Set<FileEntryId>>

  /** Insert a new row. Violates `fe_origin_consistency` / `fe_size_internal_only` → throws. */
  create(values: CreateFileEntryRow): Promise<FileEntry>

  /** Update mutable columns. Returns the refreshed row. Throws if not found. */
  update(id: FileEntryId, values: UpdateFileEntryRow): Promise<FileEntry>

  /**
   * Atomically rewrite both `externalPath` and `name` for an external entry.
   * The rename flow is the **only** sanctioned mutation site for `externalPath`;
   * doing it as a single statement keeps the (path, name) pair consistent under
   * partial-failure scenarios (transient lock, schema constraint).
   */
  setExternalPathAndName(id: FileEntryId, externalPath: CanonicalExternalPath, name: string): Promise<FileEntry>

  /** Remove the row (CASCADE drops dependent `file_ref`s). No-op if already gone. */
  delete(id: FileEntryId): Promise<void>
}

type FileEntryRow = typeof fileEntryTable.$inferSelect

function rowToFileEntry(row: FileEntryRow): FileEntry {
  return FileEntrySchema.parse(row)
}

class FileEntryServiceImpl implements FileEntryService {
  private getDb() {
    return application.get('DbService').getDb()
  }

  async findById(id: FileEntryId): Promise<FileEntry | null> {
    const rows = await this.getDb().select().from(fileEntryTable).where(eq(fileEntryTable.id, id)).limit(1)
    return rows.length === 0 ? null : rowToFileEntry(rows[0])
  }

  async getById(id: FileEntryId): Promise<FileEntry> {
    const entry = await this.findById(id)
    if (!entry) {
      throw new Error(`FileEntry not found: ${id}`)
    }
    return entry
  }

  async findByExternalPath(canonicalPath: CanonicalExternalPath): Promise<FileEntry | null> {
    const rows = await this.getDb()
      .select()
      .from(fileEntryTable)
      .where(eq(fileEntryTable.externalPath, canonicalPath))
      .limit(1)
    return rows.length === 0 ? null : rowToFileEntry(rows[0])
  }

  async findCaseInsensitivePeers(canonicalPath: CanonicalExternalPath): Promise<FileEntry[]> {
    const rows = await this.getDb()
      .select()
      .from(fileEntryTable)
      .where(
        and(
          isNotNull(fileEntryTable.externalPath),
          sql`lower(${fileEntryTable.externalPath}) = lower(${canonicalPath})`
        )
      )
    return rows.map(rowToFileEntry)
  }

  async findMany(query: FindEntriesQuery = {}): Promise<FileEntry[]> {
    const conditions: SQL[] = []
    if (query.origin) {
      conditions.push(eq(fileEntryTable.origin, query.origin))
    }
    if (query.inTrash === true) {
      conditions.push(isNotNull(fileEntryTable.trashedAt))
    } else {
      conditions.push(isNull(fileEntryTable.trashedAt))
    }

    let queryBuilder = this.getDb()
      .select()
      .from(fileEntryTable)
      .where(and(...conditions))
      .orderBy(asc(fileEntryTable.createdAt))
      .$dynamic()

    if (query.limit !== undefined) {
      queryBuilder = queryBuilder.limit(query.limit)
    }
    if (query.offset !== undefined) {
      queryBuilder = queryBuilder.offset(query.offset)
    }

    const rows = await queryBuilder
    return rows.map(rowToFileEntry)
  }

  async findUnreferenced(query: { origin?: FileEntryOrigin } = {}): Promise<FileEntry[]> {
    const conditions: SQL[] = [isNull(fileEntryTable.trashedAt), isNull(fileRefTable.id)]
    if (query.origin) conditions.push(eq(fileEntryTable.origin, query.origin))
    const rows = await this.getDb()
      .select({ entry: fileEntryTable })
      .from(fileEntryTable)
      .leftJoin(fileRefTable, eq(fileRefTable.fileEntryId, fileEntryTable.id))
      .where(and(...conditions))
      .orderBy(asc(fileEntryTable.createdAt))
    return rows.map((r) => rowToFileEntry(r.entry))
  }

  async listAllIds(): Promise<Set<FileEntryId>> {
    const rows = await this.getDb().select({ id: fileEntryTable.id }).from(fileEntryTable)
    return new Set(rows.map((r) => r.id))
  }

  async create(values: CreateFileEntryRow): Promise<FileEntry> {
    const now = Date.now()
    const id = values.id ?? uuidv7()
    const rows = await this.getDb()
      .insert(fileEntryTable)
      .values({
        id,
        origin: values.origin,
        name: values.name,
        ext: values.ext,
        size: values.size,
        externalPath: values.externalPath,
        trashedAt: values.trashedAt ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning()
    return rowToFileEntry(rows[0])
  }

  async update(id: FileEntryId, values: UpdateFileEntryRow): Promise<FileEntry> {
    const updates: Partial<typeof fileEntryTable.$inferInsert> = {
      updatedAt: Date.now()
    }
    if (values.name !== undefined) updates.name = values.name
    if (values.ext !== undefined) updates.ext = values.ext
    if (values.size !== undefined) updates.size = values.size
    if (values.trashedAt !== undefined) updates.trashedAt = values.trashedAt
    const rows = await this.getDb().update(fileEntryTable).set(updates).where(eq(fileEntryTable.id, id)).returning()
    if (rows.length === 0) {
      throw new Error(`FileEntry not found: ${id}`)
    }
    return rowToFileEntry(rows[0])
  }

  /**
   * Atomically rewrite both `externalPath` and `name` for an external entry —
   * the only sanctioned mutation site for `externalPath`. Used by the rename
   * flow so the (path, name) pair stays consistent under failure.
   */
  async setExternalPathAndName(id: FileEntryId, externalPath: CanonicalExternalPath, name: string): Promise<FileEntry> {
    const rows = await this.getDb()
      .update(fileEntryTable)
      .set({ externalPath, name, updatedAt: Date.now() })
      .where(eq(fileEntryTable.id, id))
      .returning()
    if (rows.length === 0) {
      throw new Error(`FileEntry not found: ${id}`)
    }
    return rowToFileEntry(rows[0])
  }

  async delete(id: FileEntryId): Promise<void> {
    await this.getDb().delete(fileEntryTable).where(eq(fileEntryTable.id, id))
  }
}

export const fileEntryService: FileEntryService = new FileEntryServiceImpl()
