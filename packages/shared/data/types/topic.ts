/**
 * Topic entity types
 *
 * Topics are containers for messages and belong to assistants.
 * They can be organized into groups and have tags for categorization.
 */

import type { AssistantMeta } from './meta'

/**
 * Complete topic entity as stored in database
 */
export interface Topic {
  /** Topic ID */
  id: string
  /** Topic name */
  name?: string | null
  /** Whether the name was manually edited by user */
  isNameManuallyEdited: boolean
  /** Associated assistant ID */
  assistantId?: string | null
  /** Preserved assistant info for display when assistant is deleted */
  assistantMeta?: AssistantMeta | null
  /** Topic-specific prompt override */
  prompt?: string | null
  /** Active node ID in the message tree */
  activeNodeId?: string | null
  /** Group ID for organization */
  groupId?: string | null
  /** Sort order within group */
  sortOrder: number
  /** Whether topic is pinned */
  isPinned: boolean
  /** Pinned order */
  pinnedOrder: number
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Last update timestamp (ISO string) */
  updatedAt: string
}
