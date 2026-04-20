/**
 * File API Schema definitions (read-only DataApi)
 *
 * DataApi is a **read-only data interface**. Handlers must not mutate anything —
 * no writes to SQLite, no writes to FS. But **safe read-only side effects are
 * allowed**: SQL aggregations, `fs.stat` for dangling detection, content hash
 * look-ups from in-memory caches, etc. As long as an operation is idempotent and
 * doesn't modify persistent state, it belongs here.
 *
 * Anything that mutates state (create / rename / delete / move / write / trash)
 * goes through **File IPC** (see `packages/shared/file/types/ipc.ts`).
 *
 * Endpoints:
 * - /files/entries — Entry listing and detail (flat list, no tree)
 * - /files/entries/:id/refs — File references per entry
 * - /files/refs/by-source — File references by business source
 *
 * ## External snapshot staleness
 *
 * External entries may return stale snapshots (name/ext/size are last-observed).
 * Consumers needing fresh values should use File IPC `refreshMetadata` or `read`.
 *
 * ## Opt-in derived fields
 *
 * - `includeRefCount`: pure SQL aggregate over `file_ref`
 * - `includeDangling`: queries file_module `DanglingCache`; cache miss triggers
 *   one `fs.stat` (read-only, idempotent). Internal entries always `'present'`.
 * - `includePath`: raw absolute path (via `resolvePhysicalPath`). Use for
 *   agent context embedding, drag-drop, subprocess spawn — any caller that
 *   genuinely needs a path string.
 * - `includeUrl`: file:// URL with danger-file safety wrap (returns dirname
 *   URL for `.sh/.bat/.ps1` etc.). Use for `<img src>` / `<video src>`
 *   rendering. Prevents accidental file-URL execution on dangerous file types.
 *
 * These two fields let renderer code avoid knowing Cherry's internal file
 * storage layout (id + ext concatenation, userData path). Main remains the
 * single source of truth for path resolution.
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { DanglingState, FileEntry, FileEntryId, FileEntryOrigin, FileRef } from '@shared/data/types/file'

/**
 * FileEntry augmented with optional opt-in derived fields.
 * Each field is present only when the corresponding `include*` flag was requested.
 */
export type FileEntryView = FileEntry & {
  refCount?: number
  dangling?: DanglingState
  /**
   * Raw absolute path (e.g. `/Users/me/Library/.../files/<id>.pdf` for internal,
   * or `entry.externalPath` for external). Populated when query passes
   * `includePath: true`. Use for agent context, drag-drop, subprocess spawn.
   */
  path?: string
  /**
   * file:// URL suitable for `<img src>` / `<video src>`, with danger-file
   * safety wrapping (for .sh/.bat/.ps1 etc., the URL points to the containing
   * directory instead of the file, preventing accidental execution).
   *
   * Populated when query passes `includeUrl: true`. Keeps renderer unaware
   * of internal storage layout (id + ext concatenation).
   */
  url?: string
}

export interface FileSchemas {
  // ─── Entry Queries ───

  /**
   * Entries collection query (flat list).
   *
   * Opt-in derived fields:
   * - `includeRefCount` → `refCount` (SQL aggregate over `file_ref`)
   * - `includeDangling` → `dangling` state (DanglingCache + lazy fs.stat)
   * - `includePath` → `path` (raw absolute path)
   * - `includeUrl` → `url` (file:// URL with danger-file safety)
   *
   * All are opt-in; unset fields are omitted.
   *
   * @example GET /files/entries?origin=internal&inTrash=false
   * @example GET /files/entries?includeRefCount=true&sortBy=refCount
   * @example GET /files/entries?includeUrl=true&includeDangling=true
   * @example GET /files/entries?includePath=true  // agent / drag-drop
   */
  '/files/entries': {
    GET: {
      query: {
        origin?: FileEntryOrigin
        inTrash?: boolean
        includeRefCount?: boolean
        includeDangling?: boolean
        includePath?: boolean
        includeUrl?: boolean
        sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'size' | 'refCount'
        sortOrder?: 'asc' | 'desc'
        page?: number
        limit?: number
      }
      response: OffsetPaginationResponse<FileEntryView>
    }
  }

  /**
   * Individual entry query.
   *
   * @example GET /files/entries/abc123
   * @example GET /files/entries/abc123?includePath=true&includeUrl=true
   */
  '/files/entries/:id': {
    GET: {
      params: { id: FileEntryId }
      query: {
        includeRefCount?: boolean
        includeDangling?: boolean
        includePath?: boolean
        includeUrl?: boolean
      }
      response: FileEntryView
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
      query: { sourceType: string; sourceId: string }
      response: FileRef[]
    }
  }
}
