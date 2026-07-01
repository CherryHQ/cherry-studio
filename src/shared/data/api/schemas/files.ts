/**
 * File API Schema definitions (read-only DataApi)
 *
 * DataApi is a SQL-first read surface for file data. Handlers:
 *
 * - MUST NOT read or `stat` the filesystem
 * - MUST NOT call main-side resolvers (`resolvePhysicalPath`, etc.)
 * - MUST NOT consult FS-state caches (`danglingCache.check`, `versionCache`)
 * - MUST return a **fixed shape per endpoint** — no opt-in flags that toggle extra fields
 *
 * SQL aggregation (JOIN / GROUP BY / COUNT) stays in the DB layer. Temp-session refs are
 * the narrow exception: they are main-memory CacheService state by design and are included
 * by the ref endpoints so a temp attachment is not reported as orphan during the session.
 * Anything that requires FS IO or main-side path computation lives in **File IPC** (see
 * `src/shared/types/file/ipc.ts`).
 *
 * Endpoints:
 * - `GET /files/entries`            — FileEntry list (fixed shape)
 * - `GET /files/entries/:id`        — Single entry lookup (fixed shape)
 * - `GET /files/entries/stats`      — Pure-SQL aggregate counts for sidebar filters
 * - `GET /files/entries/ref-counts` — Ref-count aggregation for a batch of ids (persistent SQL refs + temp-session cache refs)
 * - `GET /files/entries/:id/refs`   — File references for a specific entry
 * - `GET /files/refs`               — File references filtered by business source
 *
 * ## Where former opt-in derived fields live now
 *
 * The previous design exposed `includeRefCount` / `includeDangling` / `includePath` /
 * `includeUrl` as opt-in flags on the entries endpoints. They were removed to keep the
 * DataApi boundary strict — DataApi is now pure SQL, no hidden IO. The former fields
 * moved to dedicated channels:
 *
 * | Former opt-in       | Current home                                                           |
 * |---------------------|------------------------------------------------------------------------|
 * | `includeRefCount`   | `GET /files/entries/ref-counts?entryIds=...` (DataApi; persistent refs + temp-session cache refs) |
 * | `includeDangling`   | File IPC `getDanglingState` / `batchGetDanglingStates` (FS-backed)     |
 * | `includePath`       | File IPC `getPhysicalPath` / `batchGetPhysicalPaths` (main resolver)   |
 * | `includeUrl`        | Shared pure helper `toSafeFileUrl(path, ext)` in `@shared/utils/file/url`, composed in-process from the `FilePath` returned by `getPhysicalPath` (no dedicated IPC) |
 *
 * Renderers compose data by fetching the entry list here, then calling the relevant
 * batch IPC methods with the retrieved ids. Wrap the two-step pattern in a dedicated
 * hook when a pattern recurs (e.g. `useEntriesWithPresence`).
 *
 * ## External entries — no size snapshot
 *
 * External rows carry `size: null` by design — external files may change outside
 * Cherry at any time, so no DB snapshot is kept. `name` / `ext` are pure
 * projections of `externalPath` (basename / extname) and therefore stable as
 * long as the entry itself exists. Consumers needing a live `size` / `mtime`
 * call File IPC `getMetadata(id)` which performs a single `fs.stat`.
 */

import type { CursorPaginationParams, CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { FileEntry, FileEntryId, FileRef } from '@shared/data/types/file'
import { FileEntryIdSchema, FileEntryOriginSchema, FileRefSourceTypeSchema } from '@shared/data/types/file'
import * as z from 'zod'

/**
 * Per-entry reference-count record produced by `GET /files/entries/ref-counts`.
 *
 * Ref aggregation across persistent association tables plus CacheService-backed temp-session refs.
 * Entries with zero refs are still returned with `refCount = 0` so the renderer can
 * safely map by id without special-casing missing keys.
 */
export interface FileEntryRefCount {
  entryId: FileEntryId
  refCount: number
}

// ─── Pagination & batch caps ───

export const LIST_FILES_DEFAULT_LIMIT = 50
export const LIST_FILES_MAX_LIMIT = 100
/**
 * Upper bound on `entryIds` per `GET /files/entries/ref-counts` request. The
 * service still chunks the underlying `IN (…)` against SQLite's parameter cap;
 * this is the renderer-side ceiling so a runaway batch can't fan-out into
 * dozens of round-trips per call.
 */
export const REF_COUNTS_MAX_ENTRY_IDS = 500

// ─── Query schemas ───

export const ListFilesQuerySchema = z
  .strictObject({
    origin: FileEntryOriginSchema.optional(),
    inTrash: z.boolean().optional(),
    sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'size', 'ext']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    cursor: z.string().optional(),
    limit: z.int().positive().max(LIST_FILES_MAX_LIMIT).default(LIST_FILES_DEFAULT_LIMIT)
  })
  .refine(
    (q) => !(q.inTrash === true && q.origin === 'external'),
    'inTrash=true is incompatible with origin=external — external entries cannot be trashed (DB CHECK fe_external_no_delete)'
  )
export type ListFilesQueryParams = z.input<typeof ListFilesQuerySchema> & CursorPaginationParams
export type ListFilesQuery = z.output<typeof ListFilesQuerySchema>

export interface FileEntryListResponse extends CursorPaginationResponse<FileEntry> {
  total: number
}

export interface FileEntryExtCount {
  ext: string | null
  count: number
}

export interface FileEntryStats {
  activeTotal: number
  trashTotal: number
  extCounts: FileEntryExtCount[]
}

export const RefCountsQuerySchema = z.strictObject({
  entryIds: z.array(FileEntryIdSchema).max(REF_COUNTS_MAX_ENTRY_IDS)
})
export type RefCountsQueryParams = z.input<typeof RefCountsQuerySchema>
export type RefCountsQuery = z.output<typeof RefCountsQuerySchema>

export const RefsBySourceQuerySchema = z.strictObject({
  sourceType: FileRefSourceTypeSchema,
  sourceId: z.string().min(1)
})
export type RefsBySourceQueryParams = z.input<typeof RefsBySourceQuerySchema>
export type RefsBySourceQuery = z.output<typeof RefsBySourceQuerySchema>

export type FileSchemas = {
  // ─── Entry Queries (pure SQL, fixed shape) ───

  /**
   * Entries collection query (flat list).
   *
   * Fixed shape — response items are plain `FileEntry`. For ref counts,
   * dangling state, absolute paths, or safe URLs, call the dedicated endpoint
   * (for ref counts) or the corresponding File IPC method.
   *
   * Cursor semantics: an absent `cursor` returns the first page in the selected
   * order; `nextCursor` is opaque and walks to the next page with the same
   * filter/sort query. The response also includes `total` for the filtered set.
   *
   * Sorting caveat: `sortBy: 'size'` is only meaningful within an
   * `origin='internal'` filter. External rows have `size IS NULL` (no DB
   * snapshot by design), so a mixed-origin size sort collates all externals
   * using the service's null sentinel before/after sized rows by sort order.
   * Callers that need a live size-sorted view of external entries must fetch
   * unsorted and sort in the renderer after calling `getMetadata`.
   *
   * `sortBy: 'ext'` supports format/type-column ordering without requiring
   * filesystem IO; it sorts by the stored extension value.
   *
   * Trash + origin caveat: the combination `inTrash=true & origin='external'`
   * is rejected by the schema (`ListFilesQuerySchema` `.refine` rule),
   * because external rows are constrained by the DB CHECK
   * `fe_external_no_delete` to always have `deletedAt = NULL` and would
   * otherwise return an empty result with no error signal. Modelling the
   * query as a discriminated union (`{ origin: 'external'; inTrash?: false } |
   * { origin?: 'internal'; inTrash?: boolean }`) is a follow-up worth doing
   * the next time this surface is touched; the runtime refine is the
   * Phase 1 stand-in.
   *
   * @example GET /files/entries?origin=internal&inTrash=false
   */
  '/files/entries': {
    GET: {
      query?: ListFilesQueryParams
      response: FileEntryListResponse
    }
  }

  /**
   * Individual entry query. Fixed shape.
   *
   * @example GET /files/entries/abc123
   */
  '/files/entries/:id': {
    GET: {
      params: { id: FileEntryId }
      response: FileEntry
    }
  }

  /**
   * Aggregate counts for the file sidebar.
   *
   * Fixed shape and pure SQL: active/trash totals plus active extension buckets.
   * Type buckets are intentionally NOT materialized here; renderers map
   * `extCounts` to user-facing file types with the same shared extension
   * classifier used by rows.
   *
   * @example GET /files/entries/stats
   */
  '/files/entries/stats': {
    GET: {
      response: FileEntryStats
    }
  }

  /**
   * Batch ref-count aggregation for a set of entry ids.
   *
   * Counts persistent SQL association-table refs (`COUNT(*) ... GROUP BY fileEntryId`)
   * and then merges CacheService-backed temp-session refs. Each requested id appears
   * in the response — entries with zero refs return `refCount = 0` rather than being omitted.
   *
   * @example GET /files/entries/ref-counts?entryIds=abc123,def456
   */
  '/files/entries/ref-counts': {
    GET: {
      query: RefCountsQueryParams
      response: FileEntryRefCount[]
    }
  }

  // ─── File Reference Queries ───

  /**
   * File references for a specific entry.
   * @example GET /files/entries/abc123/refs
   */
  '/files/entries/:id/refs': {
    GET: {
      params: { id: FileEntryId }
      response: FileRef[]
    }
  }

  /**
   * File references filtered by business source (read-only).
   *
   * Filter dimensions follow the `api-design-guidelines.md` query-param style;
   * both `sourceType` and `sourceId` are required at the Zod layer
   * (`z.strictObject` — neither is optional), so the URL always carries the
   * full source key even though the path stays a plain `/files/refs`.
   *
   * Ref write operations are NOT exposed via DataApi. Persistent refs are
   * owned by business services; temp-session refs are main-process only.
   *
   * @example GET /files/refs?sourceType=chat_message&sourceId=msg1
   */
  '/files/refs': {
    GET: {
      query: RefsBySourceQueryParams
      response: FileRef[]
    }
  }
}
