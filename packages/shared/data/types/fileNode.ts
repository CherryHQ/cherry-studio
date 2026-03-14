/**
 * File node and file reference entity types
 *
 * FileNode represents a unified file/directory/mount node in the file tree.
 * FileRef tracks which business entities reference which file nodes.
 * Timestamps are numbers (ms epoch) matching DB integer storage.
 */

import type { MountProviderConfig } from './fileProvider'

// ─── Node Type ───

export type FileNodeType = 'file' | 'dir' | 'mount'

// ─── Entity Types ───

/** Complete file node entity as stored in database */
export interface FileNode {
  /** Node ID (UUID v7) */
  id: string
  /** Node type */
  type: FileNodeType
  /** User-visible name (without extension) */
  name: string
  /** File extension without leading dot (e.g. 'pdf', 'md'). Null for dirs/mounts */
  ext: string | null
  /** Parent node ID. Null for mount nodes (top-level) */
  parentId: string | null
  /** Mount ID this node belongs to. For mount nodes, equals own id */
  mountId: string
  /** File size in bytes. Null for dirs/mounts */
  size: number | null
  /** Provider config JSON (only for mount nodes) */
  providerConfig: MountProviderConfig | null
  /** Whether the node is read-only */
  isReadonly: boolean
  /** Remote file ID (e.g. OpenAI file-abc123) */
  remoteId: string | null
  /** Whether a local cache copy exists */
  isCached: boolean
  /** Original parent ID before moving to Trash (only for Trash direct children) */
  previousParentId: string | null
  /** Creation timestamp (ms epoch) */
  createdAt: number
  /** Last update timestamp (ms epoch) */
  updatedAt: number
}

/** File reference entity — tracks business entity to file node relationships */
export interface FileRef {
  /** Reference ID (UUID v4) */
  id: string
  /** Referenced file node ID */
  nodeId: string
  /** Business source type (e.g. 'chat_message', 'knowledge_item', 'painting') */
  sourceType: string
  /** Business object ID (polymorphic, no FK constraint) */
  sourceId: string
  /** Reference role (e.g. 'attachment', 'source', 'asset') */
  role: string
  /** Creation timestamp (ms epoch) */
  createdAt: number
  /** Last update timestamp (ms epoch) */
  updatedAt: number
}

// ─── DTOs ───

/** DTO for creating a new file or directory node */
export interface CreateNodeDto {
  /** Node type (file or dir, not mount) */
  type: 'file' | 'dir'
  /** User-visible name */
  name: string
  /** File extension without leading dot */
  ext?: string
  /** Parent node ID */
  parentId: string
  /** Mount ID */
  mountId: string
  /** File size in bytes */
  size?: number
}

/** DTO for updating a node's metadata */
export interface UpdateNodeDto {
  /** Updated name */
  name?: string
  /** Updated extension */
  ext?: string
}

/** DTO for creating a file reference */
export interface CreateFileRefDto {
  /** Business source type */
  sourceType: string
  /** Business object ID */
  sourceId: string
  /** Reference role */
  role: string
}
