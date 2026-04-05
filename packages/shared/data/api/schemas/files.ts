/**
 * File schemas: service-layer DTOs + read-only DataApi definitions
 *
 * DTOs are internal to the service layer (used by FileManager IPC handlers when
 * calling data/service). DataApi is a pure data interface — read-only, no FS side effects.
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import {
  type FileRef,
  type FileTreeNode,
  type NodeId,
  NodeIdSchema,
  SafeNameSchema,
  tempSessionRefFields
} from '@shared/data/types/file'
import * as z from 'zod'

// ============================================================================
// Service-Layer DTOs
// ============================================================================

/**
 * DTO for creating a new file or directory node.
 *
 * Internal to service layer — not exposed via DataApi.
 * FileManager IPC handlers use this when calling data/service after completing FS operations.
 *
 * - `name` — for files: full filename with extension (e.g. `report.pdf`),
 *            for dirs: directory name.
 *            Service layer splits file names into entity `name` + `ext`.
 *
 * Fields derived by the service layer (not in DTO):
 * - `mountId` — inherited from parent node
 * - `ext` — extracted from `name` for files
 * - `size` — read from actual file data
 */
export const CreateNodeDtoSchema = z.object({
  /** Node type (file or dir, not mount) */
  type: z.enum(['file', 'dir']),
  /** Full name: for files includes extension (e.g. `report.pdf`), for dirs the directory name */
  name: SafeNameSchema,
  /** Parent node ID (mountId is derived from this) */
  parentId: NodeIdSchema
})
export type CreateNodeDto = z.infer<typeof CreateNodeDtoSchema>

/**
 * DTO for updating a node's metadata.
 *
 * Internal to service layer — not exposed via DataApi.
 * Supports rename (name), move (parentId), or both (Unix mv semantics).
 * `name` is the full name (with extension for files); service splits into `name` + `ext`.
 */
export const UpdateNodeDtoSchema = z.object({
  /** Updated full name (with extension for files) */
  name: SafeNameSchema.optional(),
  /** New parent node ID (for move operations) */
  parentId: NodeIdSchema.optional()
})
export type UpdateNodeDto = z.infer<typeof UpdateNodeDtoSchema>

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
 * - /files/nodes — Node listing and detail
 * - /files/nodes/:id/children — Tree lazy-loading
 * - /files/nodes/:id/refs — File references per node
 * - /files/refs/by-source — File references by business source
 * - /files/mounts — Mount point listing
 */
export interface FileSchemas {
  // ─── Node Queries ───

  /**
   * Nodes collection query
   * @example GET /files/nodes?mountId=mount_files&type=file
   */
  '/files/nodes': {
    /** List nodes with filters and pagination */
    GET: {
      query: {
        mountId?: NodeId
        parentId?: NodeId
        type?: 'file' | 'dir'
        inTrash?: boolean
        page?: number
        limit?: number
      }
      response: OffsetPaginationResponse<FileTreeNode>
    }
  }

  /**
   * Individual node query
   * @example GET /files/nodes/abc123
   */
  '/files/nodes/:id': {
    /** Get a node by ID */
    GET: {
      params: { id: NodeId }
      response: FileTreeNode
    }
  }

  // ─── Tree Queries ───

  /**
   * Children endpoint for lazy-loading file tree
   * @example GET /files/nodes/abc123/children?sortBy=name&sortOrder=asc
   */
  '/files/nodes/:id/children': {
    /** Get child nodes with sorting and pagination */
    GET: {
      params: { id: NodeId }
      query: {
        recursive?: boolean
        /** Max tree depth when recursive=true. Clamped to server maximum (default: 20) */
        maxDepth?: number
        sortBy?: 'name' | 'updatedAt' | 'size' | 'type'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }
      response: OffsetPaginationResponse<FileTreeNode>
    }
  }

  // ─── File Reference Queries ───

  /**
   * File references for a specific node
   * @example GET /files/nodes/abc123/refs
   */
  '/files/nodes/:id/refs': {
    /** Get all references for a file node */
    GET: {
      params: { id: NodeId }
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
      response: FileTreeNode[]
    }
  }
}
