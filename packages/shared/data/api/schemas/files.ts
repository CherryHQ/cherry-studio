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
 *   genuinely needs a path string. See `FileEntryView.path` for the full
 *   convention on what consumers must NOT do with it.
 * - `includeUrl`: file:// URL with danger-file safety wrap (returns dirname
 *   URL for `.sh/.bat/.ps1` etc.). Scoped to `<img src>` / `<video src>`
 *   sync rendering — the wrap defends HTML-rendering contexts only, not
 *   arbitrary string concatenation.
 *
 * ## Path authority vs path locality
 *
 * These two fields mean renderer can **hold** a path/url string computed by
 * Main, but does not know the **resolution rule** (id + ext concatenation,
 * userData path, future storage-layout changes). Main remains the single
 * source of truth for path **resolution logic**; the presence of a string
 * value on renderer's side is a consumer of that authority, not a competitor
 * to it. Rewriting storage layout in Main keeps renderer code unchanged.
 *
 * This boundary is enforced **by convention** (JSDoc on each field) rather
 * than the type system: exposing a path is a non-trivial capability with
 * real risks (see `FileEntryView.path` convention). Code review is the
 * primary gate for "does this caller genuinely need a path?".
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  DanglingState,
  FileEntry,
  FileEntryId,
  FileEntryOrigin,
  FileRef,
  FileRefSourceType
} from '@shared/data/types/file'
import type { FilePath, FileURLString } from '@shared/file/types/common'

/**
 * FileEntry augmented with optional opt-in derived fields.
 * Each field is present only when the corresponding `include*` flag was requested.
 *
 * ## Field staleness taxonomy
 *
 * - `refCount` — **@stability consistent** — SQL aggregate over `file_ref`;
 *   freshness matches any other DataApi read. Invalidated on ref mutation.
 * - `path` / `url` — **@stability deterministic** — pure function of entry
 *   fields (id + ext, or externalPath). Freshness tracks the entry itself;
 *   no independent staleness.
 * - `dangling` — **@stability best-effort** — reflects the most recent
 *   observation (watcher event or cold-path `fs.stat`); may lag reality.
 *   See caveat below.
 *
 * ## `dangling` usage contract
 *
 * `dangling` is best-effort by design: watcher coverage is not guaranteed,
 * and `fs.stat` results are not time-invariant. Consumers requesting
 * `includeDangling: true` MUST allow React Query's natural refresh lifecycle
 * to re-probe — i.e. keep the project's default `staleTime` (5 min) or set
 * something shorter. **Do not override with `staleTime: Infinity`** — that
 * combination is self-contradictory (asking for dangling while refusing to
 * re-check it).
 *
 * For user-triggered refresh of a specific entry's snapshot + dangling state,
 * call File IPC `refreshMetadata(id)` then `mutate(...)` the query.
 */
export type FileEntryView = FileEntry & {
  refCount?: number
  dangling?: DanglingState
  /**
   * Raw absolute path (e.g. `/Users/me/Library/.../files/<id>.pdf` for internal,
   * or `entry.externalPath` for external). Populated when query passes
   * `includePath: true`.
   *
   * ## Intended uses
   *
   * - **Agent context embedding** — passing a path string to an LLM prompt
   * - **Drag-drop to external apps** — supplying the `file` field to
   *   `webContents.startDrag` via a File IPC helper
   * - **Subprocess spawn** — giving a path to a child process or third-party
   *   CLI that only accepts path arguments
   * - **"Open in external editor" UX** — copy-to-clipboard or explicit export
   *
   * ## NOT intended uses (convention)
   *
   * - **Do NOT** treat this as a stable identifier — storage layout may change
   *   (e.g. flat → hashed subfolders). Always re-query after the underlying
   *   entry mutates. Do not cache or serialize paths across sessions.
   * - **Do NOT** construct navigation or shell commands by string-concat
   *   without independent sanitization — this field is a value, not a
   *   pre-validated capability.
   * - **Do NOT** use this as a shortcut to bypass FileManager for writes —
   *   mutations still must go through File IPC so version / dangling / FS
   *   invariants are preserved.
   * - **Do NOT** request `includePath: true` if the consumer only needs an
   *   identity reference — use `entry.id` instead.
   *
   * Exposing raw paths is a meaningful capability with real abuse potential
   * (renderer could in principle hand the string to any IPC that takes a path).
   * This is enforced by **convention only**; code review should verify each
   * call site against the "intended uses" list above. The branded `FilePath`
   * type at least forces a type-level narrowing ceremony before a caller can
   * pipe this value into another path-typed API — a bare `string` would not.
   */
  path?: FilePath
  /**
   * file:// URL suitable for `<img src>` / `<video src>`, with danger-file
   * safety wrapping (for .sh/.bat/.ps1 etc., the URL points to the containing
   * directory instead of the file, preventing accidental execution).
   *
   * Populated when query passes `includeUrl: true`. Keeps renderer unaware
   * of internal storage layout (id + ext concatenation).
   *
   * The `FileURLString` brand (`file://${string}`) prevents accidental
   * substitution with an `http`/`https` `URLString`; consumers that accept
   * any URL should widen explicitly rather than rely on structural typing.
   *
   * ## Scope of the safety wrap
   *
   * The danger-file wrap defends **HTML rendering contexts only** — specifically
   * the `<img src>` / `<video src>` / `<embed>` paths where hovering or loading
   * could trigger OS-level preview behaviors on certain file types. It is
   * **NOT** a generic path-safety primitive:
   *
   * - Do NOT compose this URL into command-line arguments or subprocess args
   * - Do NOT assume the wrap sanitizes against injection in text contexts
   * - Use `includePath` instead when the consumer needs the raw path value
   */
  url?: FileURLString
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
      query: { sourceType: FileRefSourceType; sourceId: string }
      response: FileRef[]
    }
  }
}
