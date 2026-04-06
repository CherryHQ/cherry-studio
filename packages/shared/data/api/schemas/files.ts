/**
 * File API Schema definitions (read-only DataApi)
 *
 * DataApi is a pure data interface — read-only, no FS side effects.
 * FS-side-effect operations go through File IPC (separate type definitions).
 *
 * Endpoints:
 * - /files/entries — Entry listing and detail
 * - /files/entries/:id/children — Tree lazy-loading
 * - /files/entries/:id/refs — File references per entry
 * - /files/refs/by-source — File references by business source
 * - /files/mounts — Mount point listing
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { FileEntry, FileEntryId, FileRef, Mount } from '@shared/data/types/file'
export interface FileSchemas {
  // ─── Entry Queries ───

  /**
   * Entries collection query
   * @example GET /files/entries?mountId=mount_files&type=file
   */
  '/files/entries': {
    /** List entries with filters and pagination */
    GET: {
      query: {
        mountId?: FileEntryId
        parentId?: FileEntryId
        type?: 'file' | 'dir'
        inTrash?: boolean
        page?: number
        limit?: number
      }
      response: OffsetPaginationResponse<FileEntry>
    }
  }

  /**
   * Individual entry query
   * @example GET /files/entries/abc123
   */
  '/files/entries/:id': {
    /** Get an entry by ID */
    GET: {
      params: { id: FileEntryId }
      response: FileEntry
    }
  }

  // ─── Tree Queries ───

  /**
   * Children endpoint for lazy-loading file tree
   * @example GET /files/entries/abc123/children?sortBy=name&sortOrder=asc
   */
  '/files/entries/:id/children': {
    /** Get child entries with sorting and pagination */
    GET: {
      params: { id: FileEntryId }
      query: {
        recursive?: boolean
        /** Max tree depth when recursive=true. Clamped to server maximum (default: 20) */
        maxDepth?: number
        sortBy?: 'name' | 'updatedAt' | 'size' | 'type'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }
      response: OffsetPaginationResponse<FileEntry>
    }
  }

  // ─── File Reference Queries ───

  /**
   * File references for a specific entry
   * @example GET /files/entries/abc123/refs
   */
  '/files/entries/:id/refs': {
    /** Get all references for a file entry */
    GET: {
      params: { id: FileEntryId }
      response: FileRef[]
    }
  }

  /**
   * File references by business source (read-only)
   *
   * Ref write operations (create / cleanup) are NOT exposed via DataApi.
   * Business services call fileRefService directly; Renderer does not manage refs.
   *
   * @example GET /files/refs/by-source?sourceType=chat_message&sourceId=msg1
   */
  '/files/refs/by-source': {
    /** Get all file references for a business object */
    GET: {
      query: { sourceType: string; sourceId: string }
      response: FileRef[]
    }
  }

  // ─── Mounts ───

  /**
   * Mount points listing
   * @example GET /files/mounts?includeSystem=true
   */
  '/files/mounts': {
    /** Get mount point list (excludes system mounts like Trash by default) */
    GET: {
      query: { includeSystem?: boolean }
      response: Mount[]
    }
  }
}
