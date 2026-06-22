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
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { FileEntryListResponse } from '@shared/data/api/schemas/files'
import type { CanonicalExternalPath, FileEntry, FileEntryId, FileEntryOrigin } from '@shared/data/types/file'
import { AbsolutePathSchema, FileEntrySchema, SafeNameSchema } from '@shared/data/types/file'
import { and, asc, count, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { ZodError } from 'zod'

const logger = loggerService.withContext('FileEntryService')

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
  readonly deletedAt?: number | null
}

/**
 * Columns that may be mutated post-insert. Origin / id / externalPath are
 * immutable. Note `size` is included because internal-file writes update the
 * byte count atomically; on external rows it must remain `null`.
 */
export type UpdateFileEntryRow = Partial<Pick<CreateFileEntryRow, 'name' | 'ext' | 'size'>> & {
  readonly deletedAt?: number | null
}

export interface FindEntriesQuery {
  readonly origin?: FileEntryOrigin
  readonly inTrash?: boolean
  readonly limit?: number
  readonly offset?: number
}

export type ListFilesSortBy = 'name' | 'createdAt' | 'updatedAt' | 'size'

export interface ListCursorQuery {
  readonly origin?: FileEntryOrigin
  readonly inTrash?: boolean
  readonly sortBy?: ListFilesSortBy
  readonly sortOrder?: 'asc' | 'desc'
  readonly cursor?: string
  readonly limit?: number
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
   * case-insensitively (`lower(externalPath) = lower(canonicalPath)`).
   * Byte-exact matches are included; callers that only want "case-different
   * peers" should filter the byte-exact self-match from the result.
   *
   * Backed by the functional unique index `fe_external_path_lower_unique_idx`
   * (`lower(external_path)`) — SQLite expression-matches the WHERE clause
   * against the index, so this lookup is O(log N) and runs the same plan
   * regardless of `file_entry` table size. The size-threshold gate that the
   * earlier "best-effort warn-only" contract recommended is no longer needed
   * and has been removed from the architecture doc.
   *
   * Returns at most one row in practice: the same functional unique index
   * makes "two rows that case-collide" an unrepresentable DB state. The
   * array return shape is preserved for forward-compat with possible future
   * relaxations (e.g. a trashed-aware variant), and so call sites that
   * iterate stay stable.
   *
   * The application-layer reuse / reject decision for a case-collision peer
   * lives in `ensureExternalEntry` (`fs.realpath` resolves whether the two
   * case-different paths are the same FS entity); see
   * `file-manager-architecture.md §1.2 Duplicate-entry detection on insert`.
   *
   * Un-parseable rows are skipped with a warning (see `rowToFileEntrySafe`).
   */
  findCaseInsensitivePeers(canonicalPath: CanonicalExternalPath): Promise<FileEntry[]>

  /**
   * Flat listing. Trashed filter defaults to "active only" when `inTrash` is omitted.
   * Un-parseable rows are skipped with a warning (see `rowToFileEntrySafe`).
   */
  findMany(query?: FindEntriesQuery): Promise<FileEntry[]>

  /**
   * Cursor-and-count list backing `GET /files/entries`. Returns
   * `{ items, total, nextCursor }` matching the DataApi cursor response shape,
   * doing the select + count in a single round-trip via `Promise.all`.
   *
   * Defaults: `limit = 50`, `sortBy = 'createdAt'`, `sortOrder = 'asc'`.
   * Trashed filter defaults to "active only" when `inTrash` is omitted, matching
   * `findMany`.
   *
   * `sortBy: 'size'` is only meaningful within an `origin='internal'` filter
   * (external rows have `size IS NULL`); see the schema-level JSDoc for the
   * mixed-origin caveat.
   *
   * Un-parseable rows are skipped with a warning (see `rowToFileEntrySafe`).
   * `total` is a SQL count and may exceed `items.length` when corrupted
   * rows were skipped.
   */
  listCursor(query?: ListCursorQuery): Promise<FileEntryListResponse>

  /**
   * Active (non-trashed) entries with zero `file_ref` rows pointing at them.
   * Used by Phase 1b.4 OrphanRefScanner's report-only entry pass — see
   * file-manager-architecture §7.1 (default policy is "preserve").
   *
   * Un-parseable rows are skipped with a warning (see `rowToFileEntrySafe`).
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

/**
 * DB row → branded `FileEntry` BO.
 *
 * The DB row carries every column physically (with `null` for fields that
 * don't apply to the row's origin); the BO is a discriminated union where
 * each variant only declares the fields it actually owns. Dispatch on
 * `row.origin`, build a variant-specific plain object dropping the
 * irrelevant columns, then `FileEntrySchema.parse` rehydrates the brand
 * and validates the invariants. See the `fileEntry.ts` header docstring
 * for the "DB row vs Business Object" boundary.
 *
 * Why not align with the project's `nullsToUndefined + timestampToISO`
 * row→entity helper: those helpers were designed for entity types whose
 * schemas use `undefined` for absence and ISO strings for timestamps —
 * FileEntry uses field absence (`origin`-driven) for absence and `number`
 * ms-epoch for timestamps, so the helpers' translations would actively
 * misshape the row. The dispatch-then-parse pattern here is the
 * discriminated-union counterpart and is documented in
 * `docs/references/data/data-api-in-main.md` (§"When `nullsToUndefined +
 * spread` is NOT a fit") as an accepted alternative.
 */
function rowToFileEntry(row: FileEntryRow): FileEntry {
  if (row.origin === 'internal') {
    return FileEntrySchema.parse({
      id: row.id,
      origin: 'internal',
      name: row.name,
      ext: row.ext,
      size: row.size,
      // deletedAt is `optional` on the BO — present iff the DB column is
      // non-null. Bypass `nullsToUndefined` so we don't pull in a helper
      // whose project-wide meaning is "every null becomes undefined";
      // here only this specific column flips.
      ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })
  }
  return FileEntrySchema.parse({
    id: row.id,
    origin: 'external',
    name: row.name,
    ext: row.ext,
    externalPath: row.externalPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  })
}

/**
 * Fault-isolating variant of `rowToFileEntry` for BULK reads only.
 *
 * One legacy-corrupted row must not take down a whole collection query —
 * and with it `danglingCache.initFromDb` → `FileManager.onInit` → the
 * entire File IPC surface for the session (#15733). Point reads
 * (`findById` / `getById` / `findByExternalPath`) and write-read-backs
 * (`create` / `update` / `setExternalPathAndName`) deliberately keep
 * throwing: there the caller named a specific row or just validated the
 * payload pre-write, so a silent null would mask a real bug.
 *
 * Contract change for bulk reads: they return every PARSEABLE row, not
 * every physically existing row. Excluded rows are warned with their id.
 *
 * Only validation failures (`ZodError`) are isolated — anything else
 * rethrows, so a programming error inside `rowToFileEntry` cannot
 * masquerade as a corrupt row and vanish from bulk reads.
 */
function rowToFileEntrySafe(row: FileEntryRow): FileEntry | null {
  try {
    return rowToFileEntry(row)
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    logger.warn('Skipping un-parseable file_entry row in bulk read', {
      id: row.id,
      issues: error.issues
    })
    return null
  }
}

type ListSortBy = NonNullable<ListCursorQuery['sortBy']>
type ListSortOrder = NonNullable<ListCursorQuery['sortOrder']>
type FileEntryCursorPayload = {
  sortBy: ListSortBy
  sortOrder: ListSortOrder
  value: string | number
  id: FileEntryId
}

const DEFAULT_LIST_SORT_BY: ListSortBy = 'createdAt'
const DEFAULT_LIST_SORT_ORDER: ListSortOrder = 'asc'
const FILE_ENTRY_SIZE_NULL_SORT_VALUE = -1

function getListSortValue(row: FileEntryRow, sortBy: ListSortBy): string | number {
  switch (sortBy) {
    case 'name':
      return row.name
    case 'updatedAt':
      return row.updatedAt
    case 'size':
      return row.size ?? FILE_ENTRY_SIZE_NULL_SORT_VALUE
    case 'createdAt':
      return row.createdAt
  }
}

function getListSortExpression(sortBy: ListSortBy): SQL<string | number> {
  switch (sortBy) {
    case 'name':
      return sql<string>`${fileEntryTable.name}`
    case 'updatedAt':
      return sql<number>`${fileEntryTable.updatedAt}`
    case 'size':
      return sql<number>`coalesce(${fileEntryTable.size}, ${FILE_ENTRY_SIZE_NULL_SORT_VALUE})`
    case 'createdAt':
      return sql<number>`${fileEntryTable.createdAt}`
  }
}

function encodeListCursor(row: FileEntryRow, sortBy: ListSortBy, sortOrder: ListSortOrder): string {
  return Buffer.from(JSON.stringify({ sortBy, sortOrder, value: getListSortValue(row, sortBy), id: row.id })).toString(
    'base64url'
  )
}

function warnAndIgnoreListCursor(raw: string, reason: string): null {
  logger.warn('listCursor: cursor unparseable, falling back to first page', { cursor: raw, reason })
  return null
}

function decodeListCursor(
  raw: string | undefined,
  sortBy: ListSortBy,
  sortOrder: ListSortOrder
): FileEntryCursorPayload | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FileEntryCursorPayload>
    if (parsed.sortBy !== sortBy || parsed.sortOrder !== sortOrder) {
      return warnAndIgnoreListCursor(raw, 'cursor sort does not match current query')
    }
    if (!parsed.id || typeof parsed.id !== 'string') {
      return warnAndIgnoreListCursor(raw, 'missing id')
    }
    const value = parsed.value
    if (sortBy === 'name') {
      if (typeof value !== 'string') return warnAndIgnoreListCursor(raw, 'sort value has wrong type')
      return { sortBy, sortOrder, value, id: parsed.id }
    }
    if (typeof value !== 'number') return warnAndIgnoreListCursor(raw, 'sort value has wrong type')
    return { sortBy, sortOrder, value, id: parsed.id }
  } catch (error) {
    return warnAndIgnoreListCursor(raw, error instanceof Error ? error.message : String(error))
  }
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
      throw DataApiErrorFactory.notFound('FileEntry', id)
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
      // Deterministic ordering for the duplicate-suspect warn log so the
      // first row in the list is stable across runs (helpful for snapshot
      // tests and for the surviving-row selection in any future FileMigrator
      // dedupe pass).
      .orderBy(asc(fileEntryTable.createdAt), asc(fileEntryTable.id))
    return rows.map(rowToFileEntrySafe).filter((e): e is FileEntry => e !== null)
  }

  async findMany(query: FindEntriesQuery = {}): Promise<FileEntry[]> {
    const conditions: SQL[] = []
    if (query.origin) {
      conditions.push(eq(fileEntryTable.origin, query.origin))
    }
    if (query.inTrash === true) {
      conditions.push(isNotNull(fileEntryTable.deletedAt))
    } else {
      conditions.push(isNull(fileEntryTable.deletedAt))
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
    return rows.map(rowToFileEntrySafe).filter((e): e is FileEntry => e !== null)
  }

  async listCursor(query: ListCursorQuery = {}): Promise<FileEntryListResponse> {
    const filterConditions: SQL[] = []
    if (query.origin) {
      filterConditions.push(eq(fileEntryTable.origin, query.origin))
    }
    if (query.inTrash === true) {
      filterConditions.push(isNotNull(fileEntryTable.deletedAt))
    } else {
      filterConditions.push(isNull(fileEntryTable.deletedAt))
    }

    const sortBy = query.sortBy ?? DEFAULT_LIST_SORT_BY
    const sortOrder = query.sortOrder ?? DEFAULT_LIST_SORT_ORDER
    const sortExpression = getListSortExpression(sortBy)
    const cursor = decodeListCursor(query.cursor, sortBy, sortOrder)
    const conditions = [...filterConditions]
    if (cursor) {
      conditions.push(
        sortOrder === 'desc'
          ? sql`(${sortExpression} < ${cursor.value} OR (${sortExpression} = ${cursor.value} AND ${fileEntryTable.id} < ${cursor.id}))`
          : sql`(${sortExpression} > ${cursor.value} OR (${sortExpression} = ${cursor.value} AND ${fileEntryTable.id} > ${cursor.id}))`
      )
    }

    // Stable ORDER BY: append `id` as a tie-breaker so rows that share the
    // user-selected sort value (same createdAt, same name, etc.) have a
    // deterministic relative order across cursor pages.
    const tieBreaker = sortOrder === 'desc' ? desc(fileEntryTable.id) : asc(fileEntryTable.id)
    const order = sortOrder === 'desc' ? desc(sortExpression) : asc(sortExpression)

    const pageSize = query.limit ?? 50
    const where = and(...conditions)
    const filterWhere = and(...filterConditions)

    const [rows, totalRow] = await Promise.all([
      this.getDb()
        .select()
        .from(fileEntryTable)
        .where(where)
        .orderBy(order, tieBreaker)
        .limit(pageSize + 1),
      this.getDb().select({ value: count() }).from(fileEntryTable).where(filterWhere)
    ])
    const pageRows = rows.slice(0, pageSize)

    return {
      items: pageRows.map(rowToFileEntrySafe).filter((e): e is FileEntry => e !== null),
      total: totalRow[0]?.value ?? 0,
      nextCursor:
        rows.length > pageSize && pageRows.length > 0
          ? encodeListCursor(pageRows[pageRows.length - 1], sortBy, sortOrder)
          : undefined
    }
  }

  async findUnreferenced(query: { origin?: FileEntryOrigin } = {}): Promise<FileEntry[]> {
    const conditions: SQL[] = [isNull(fileEntryTable.deletedAt), isNull(fileRefTable.id)]
    if (query.origin) conditions.push(eq(fileEntryTable.origin, query.origin))
    const rows = await this.getDb()
      .select({ entry: fileEntryTable })
      .from(fileEntryTable)
      .leftJoin(fileRefTable, eq(fileRefTable.fileEntryId, fileEntryTable.id))
      .where(and(...conditions))
      .orderBy(asc(fileEntryTable.createdAt))
    return rows.map((r) => rowToFileEntrySafe(r.entry)).filter((e): e is FileEntry => e !== null)
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
        deletedAt: values.deletedAt ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning()
    return rowToFileEntry(rows[0])
  }

  async update(id: FileEntryId, values: UpdateFileEntryRow): Promise<FileEntry> {
    // Validate user-controlled string columns BEFORE the SQL UPDATE so a
    // rejected value never persists. Without this, a name failing
    // `SafeNameSchema` (path separators, `..`, null bytes, > 255 chars)
    // commits to SQLite first and only fails at `rowToFileEntry`'s
    // schema parse — leaving the row permanently un-parseable.
    if (values.name !== undefined) SafeNameSchema.parse(values.name)
    const updates: Partial<typeof fileEntryTable.$inferInsert> = {
      updatedAt: Date.now()
    }
    if (values.name !== undefined) updates.name = values.name
    if (values.ext !== undefined) updates.ext = values.ext
    if (values.size !== undefined) updates.size = values.size
    if (values.deletedAt !== undefined) updates.deletedAt = values.deletedAt
    const rows = await this.getDb().update(fileEntryTable).set(updates).where(eq(fileEntryTable.id, id)).returning()
    if (rows.length === 0) {
      throw DataApiErrorFactory.notFound('FileEntry', id)
    }
    return rowToFileEntry(rows[0])
  }

  /**
   * Atomically rewrite both `externalPath` and `name` for an external entry —
   * the only sanctioned mutation site for `externalPath`. Used by the rename
   * flow so the (path, name) pair stays consistent under failure.
   */
  async setExternalPathAndName(id: FileEntryId, externalPath: CanonicalExternalPath, name: string): Promise<FileEntry> {
    // Same pre-SQL validation rationale as `update` above; an unsafe value
    // for either column would corrupt the row past `rowToFileEntry` parse.
    // The `CanonicalExternalPath` brand is TS-only — defense-in-depth at the
    // runtime layer rejects path strings the brand failed to flag (e.g. a
    // caller that `as`-cast a raw user string instead of going through
    // `canonicalizeExternalPath`).
    SafeNameSchema.parse(name)
    AbsolutePathSchema.parse(externalPath)
    const rows = await this.getDb()
      .update(fileEntryTable)
      .set({ externalPath, name, updatedAt: Date.now() })
      .where(eq(fileEntryTable.id, id))
      .returning()
    if (rows.length === 0) {
      throw DataApiErrorFactory.notFound('FileEntry', id)
    }
    return rowToFileEntry(rows[0])
  }

  async delete(id: FileEntryId): Promise<void> {
    await this.getDb().delete(fileEntryTable).where(eq(fileEntryTable.id, id))
  }
}

export const fileEntryService: FileEntryService = new FileEntryServiceImpl()
