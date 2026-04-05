/**
 * File DataApi Schema definitions (read-only)
 *
 * DataApi is a pure data interface — it manages DB reads with no FS side effects.
 * All write operations that may affect the filesystem (create, rename, move, trash,
 * delete, upload) are handled by FileManager IPC, which internally calls data/service
 * for DB synchronization.
 *
 * FileRef creation is not exposed here — refs are created internally by business
 * services (MessageService, KnowledgeService, etc.) as side effects of their own
 * operations. Only ref queries and cleanup are provided.
 */

import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { FileRef, FileTreeNode, NodeId } from '@shared/data/types/file'

// ============================================================================
// API Schema Definitions
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
   * File references by business source
   * @example GET /files/refs/by-source?sourceType=chat_message&sourceId=msg1
   * @example DELETE /files/refs/by-source?sourceType=chat_message&sourceId=msg1
   */
  '/files/refs/by-source': {
    /** Get all file references for a business object */
    GET: {
      query: { sourceType: string; sourceId: string }
      response: FileRef[]
    }
    /** Clean up all references for a business object (pure DB operation, no FS side effects) */
    DELETE: {
      query: { sourceType: string; sourceId: string }
      response: void
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
