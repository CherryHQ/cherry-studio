/**
 * File schemas: service-layer DTOs + read-only DataApi definitions
 *
 * DTOs are internal to the service layer (used by FileService when calling
 * FileTreeService for DB operations). DataApi is a pure data interface —
 * read-only, no FS side effects.
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import {
  type FileEntry,
  type FileEntryId,
  FileEntryIdSchema,
  type FileRef,
  SafeNameSchema,
  tempSessionRefFields
} from '@shared/data/types/file'
import * as z from 'zod'

// ============================================================================
// Service-Layer DTOs
// ============================================================================

/**
 * DTO for creating a new file or directory entry.
 *
 * Internal to service layer — not exposed via DataApi.
 * FileService uses this when calling FileTreeService after completing FS operations.
 *
 * - `name` — for files: full filename with extension (e.g. `report.pdf`),
 *            for dirs: directory name.
 *            Service layer splits file names into entity `name` + `ext`.
 *
 * Fields derived by the service layer (not in DTO):
 * - `mountId` — inherited from parent entry
 * - `ext` — extracted from `name` for files
 * - `size` — read from actual file data
 */
export const CreateEntryDtoSchema = z.object({
  /** Entry type (file or dir, not mount) */
  type: z.enum(['file', 'dir']),
  /** Full name: for files includes extension (e.g. `report.pdf`), for dirs the directory name */
  name: SafeNameSchema,
  /** Parent entry ID (mountId is derived from this) */
  parentId: FileEntryIdSchema
})
export type CreateEntryDto = z.infer<typeof CreateEntryDtoSchema>

/**
 * DTO for updating an entry's metadata.
 *
 * Internal to service layer — not exposed via DataApi.
 * Supports rename (name), move (parentId), or both (Unix mv semantics).
 * `name` is the full name (with extension for files); service splits into `name` + `ext`.
 */
export const UpdateEntryDtoSchema = z.object({
  /** Updated full name (with extension for files) */
  name: SafeNameSchema.optional(),
  /** New parent entry ID (for move operations) */
  parentId: FileEntryIdSchema.optional()
})
export type UpdateEntryDto = z.infer<typeof UpdateEntryDtoSchema>

/**
 * DTO for creating a file reference.
 *
 * Discriminated union on `sourceType` — each variant narrows `role` to valid
 * values for that source type, using the business fields from each ref variant.
 *
 * When adding a new FileRef variant, add its `*RefFields` here as well.
 */
export const CreateFileRefDtoSchema = z.discriminatedUnion('sourceType', [z.object(tempSessionRefFields)])
export type CreateFileRefDto = z.infer<typeof CreateFileRefDtoSchema>

// ============================================================================
// API Schema Definitions (read-only)
// ============================================================================

/**
 * File API Schema definitions
 *
 * Read-only endpoints organized by domain:
 * - /files/entries — Entry listing and detail
 * - /files/entries/:id/children — Tree lazy-loading
 * - /files/entries/:id/refs — File references per entry
 * - /files/refs/by-source — File references by business source
 * - /files/mounts — Mount point listing
 */
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
      response: FileEntry[]
    }
  }
}
