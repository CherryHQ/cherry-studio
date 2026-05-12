/**
 * File API Schema definitions (read-only DataApi)
 *
 * DataApi is a **pure SQL read surface** for file data. Handlers:
 *
 * - MUST NOT read or `stat` the filesystem
 * - MUST NOT call main-side resolvers (`resolvePhysicalPath`, etc.)
 * - MUST NOT consult in-memory caches outside the DB (no `danglingCache.check`, no `versionCache`)
 * - MUST return a **fixed shape per endpoint** — no opt-in flags that toggle extra fields
 *
 * The only allowed "derivation" inside DataApi is **SQL aggregation** (JOIN / GROUP BY /
 * COUNT), because that stays in the DB layer. Anything that requires FS IO or main-side
 * computation lives in **File IPC** (see `packages/shared/file/types/ipc.ts`).
 *
 * Endpoints:
 * - `GET /files/entries`            — FileEntry list (fixed shape)
 * - `GET /files/entries/:id`        — Single entry lookup (fixed shape)
 * - `GET /files/entries/ref-counts` — Pure-SQL ref-count aggregation for a batch of ids
 * - `GET /files/entries/:id/refs`   — File references for a specific entry
 * - `GET /files/refs/by-source`     — File references by business source
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
 * | `includeRefCount`   | `GET /files/entries/ref-counts?entryIds=...` (still DataApi, dedicated)|
 * | `includeDangling`   | File IPC `getDanglingState` / `batchGetDanglingStates` (FS-backed)     |
 * | `includePath`       | File IPC `getPhysicalPath` / `batchGetPhysicalPaths` (main resolver)   |
 * | `includeUrl`        | Shared pure helper `toSafeFileUrl(path, ext)` in `@shared/file/urlUtil`, composed in-process from the `FilePath` returned by `getPhysicalPath` (no dedicated IPC) |
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

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { FileEntry, FileEntryId, FileRef } from '@shared/data/types/file'
import { FileEntryIdSchema, FileEntryOriginSchema, FileRefSourceTypeSchema } from '@shared/data/types/file'
import * as z from 'zod'

/**
 * Per-entry reference-count record produced by `GET /files/entries/ref-counts`.
 *
 * Pure SQL aggregation (`SELECT fileEntryId, COUNT(*) FROM file_ref GROUP BY fileEntryId`).
 * Entries with zero refs are still returned with `refCount = 0` so the renderer can
 * safely map by id without special-casing missing keys.
 */
export interface FileEntryRefCount {
  entryId: FileEntryId
  refCount: number
}

// ─── Pagination & batch caps ───

export const LIST_FILES_DEFAULT_PAGE = 1
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

export const ListFilesQuerySchema = z.strictObject({
  origin: FileEntryOriginSchema.optional(),
  inTrash: z.boolean().optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt', 'size']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.int().positive().default(LIST_FILES_DEFAULT_PAGE),
  limit: z.int().positive().max(LIST_FILES_MAX_LIMIT).default(LIST_FILES_DEFAULT_LIMIT)
})
export type ListFilesQueryParams = z.input<typeof ListFilesQuerySchema>
export type ListFilesQuery = z.output<typeof ListFilesQuerySchema>

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
   * Sorting caveat: `sortBy: 'size'` is only meaningful within an
   * `origin='internal'` filter. External rows have `size IS NULL` (no DB
   * snapshot by design), so a mixed-origin size sort collates all externals
   * at one end (SQLite NULLs last for ASC, first for DESC). Callers that need
   * a live size-sorted view of external entries must fetch unsorted and sort
   * in the renderer after calling `getMetadata`.
   *
   * Trash + origin caveat: the combination `inTrash=true & origin='external'`
   * is permitted by the schema but always returns `{ items: [], total: 0 }`,
   * because external rows are constrained by the DB CHECK
   * `fe_external_no_trash` to always have `trashedAt = NULL`. A caller hitting
   * this combo will see an empty result with no error signal — typical
   * symptom is "why are my external files missing?". Modelling the query as
   * a discriminated union (`{ origin: 'external'; inTrash?: false } |
   * { origin?: 'internal'; inTrash?: boolean }`) is a follow-up worth doing
   * the next time this surface is touched; left as JSDoc for Phase 1.
   *
   * @example GET /files/entries?origin=internal&inTrash=false
   */
  '/files/entries': {
    GET: {
      query?: ListFilesQueryParams
      response: OffsetPaginationResponse<FileEntry>
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
   * Batch ref-count aggregation for a set of entry ids.
   *
   * Pure SQL (`COUNT(*) ... GROUP BY fileEntryId`). Each requested id appears in the
   * response — entries with zero refs return `refCount = 0` rather than being omitted.
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
   * File references by business source (read-only).
   *
   * Ref write operations (create / cleanup) are NOT exposed via DataApi.
   * Business services call fileRefService directly; Renderer does not manage refs.
   *
   * @example GET /files/refs/by-source?sourceType=chat_message&sourceId=msg1
   */
  '/files/refs/by-source': {
    GET: {
      query: RefsBySourceQueryParams
      response: FileRef[]
    }
  }
}
