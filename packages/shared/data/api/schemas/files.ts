/**
 * File API Schema definitions
 *
 * Contains all file-related endpoints for node CRUD, tree operations,
 * file references, and mount management.
 */

import type { CreateFileRefDto, CreateNodeDto, FileNode, FileRef, UpdateNodeDto } from '@shared/data/types/fileNode'

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * File API Schema definitions
 *
 * Organized by domain responsibility:
 * - /files/nodes - Node CRUD and listing
 * - /files/nodes/:id/* - Tree operations (children, move, trash, restore)
 * - /files/nodes/:id/refs - File references per node
 * - /files/refs/by-source - File references by business source
 * - /files/nodes/batch/* - Batch operations
 * - /files/mounts - Mount point listing
 */
export interface FileSchemas {
  // ─── Node CRUD ───

  /**
   * Nodes collection endpoint
   * @example GET /files/nodes?mountId=mount_files&type=file
   * @example POST /files/nodes { "type": "file", "name": "doc", "parentId": "..." }
   */
  '/files/nodes': {
    /** List nodes with filters */
    GET: {
      query: {
        mountId?: string
        parentId?: string
        type?: 'file' | 'dir'
        inTrash?: boolean
      }
      response: FileNode[]
    }
    /** Create a node (upload file / create directory) */
    POST: {
      body: CreateNodeDto
      response: FileNode
    }
  }

  /**
   * Individual node endpoint
   * @example GET /files/nodes/abc123
   * @example PATCH /files/nodes/abc123 { "name": "renamed" }
   * @example DELETE /files/nodes/abc123
   */
  '/files/nodes/:id': {
    /** Get a node by ID */
    GET: {
      params: { id: string }
      response: FileNode
    }
    /** Update node metadata (rename, etc.) */
    PATCH: {
      params: { id: string }
      body: UpdateNodeDto
      response: FileNode
    }
    /** Permanently delete a node */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  // ─── Tree Operations ───

  /**
   * Children endpoint for lazy-loading file tree
   * @example GET /files/nodes/abc123/children?sortBy=name&sortOrder=asc
   */
  '/files/nodes/:id/children': {
    /** Get child nodes with sorting and pagination */
    GET: {
      params: { id: string }
      query: {
        recursive?: boolean
        sortBy?: 'name' | 'updatedAt' | 'size' | 'type'
        sortOrder?: 'asc' | 'desc'
        limit?: number
        offset?: number
      }
      response: FileNode[]
    }
  }

  /**
   * Move node to a new parent
   * @example PUT /files/nodes/abc123/move { "targetParentId": "dir456" }
   */
  '/files/nodes/:id/move': {
    PUT: {
      params: { id: string }
      body: { targetParentId: string }
      response: FileNode
    }
  }

  /**
   * Trash a node (soft delete)
   * @example PUT /files/nodes/abc123/trash
   */
  '/files/nodes/:id/trash': {
    PUT: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Restore a node from Trash
   * @example PUT /files/nodes/abc123/restore
   */
  '/files/nodes/:id/restore': {
    PUT: {
      params: { id: string }
      response: FileNode
    }
  }

  // ─── File References ───

  /**
   * File references for a specific node
   * @example GET /files/nodes/abc123/refs
   * @example POST /files/nodes/abc123/refs { "sourceType": "chat_message", "sourceId": "msg1", "role": "attachment" }
   */
  '/files/nodes/:id/refs': {
    /** Get all references for a file node */
    GET: {
      params: { id: string }
      response: FileRef[]
    }
    /** Create a reference to a file node */
    POST: {
      params: { id: string }
      body: CreateFileRefDto
      response: FileRef
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
    /** Clean up all references for a business object */
    DELETE: {
      query: { sourceType: string; sourceId: string }
      response: void
    }
  }

  // ─── Batch Operations ───

  /** Batch trash nodes */
  '/files/nodes/batch/trash': {
    PUT: {
      body: { ids: string[] }
      response: void
    }
  }

  /** Batch move nodes to target directory */
  '/files/nodes/batch/move': {
    PUT: {
      body: { ids: string[]; targetParentId: string }
      response: void
    }
  }

  /** Batch permanently delete nodes (uses POST to avoid DELETE-with-body compatibility issues) */
  '/files/nodes/batch/delete': {
    POST: {
      body: { ids: string[] }
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
      response: FileNode[]
    }
  }
}
