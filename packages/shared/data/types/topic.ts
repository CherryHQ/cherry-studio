/**
 * Topic entity types
 *
 * Topics are containers for messages. They reference the last-used assistant
 * and can be organized into groups.
 */

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
  /** Last-used assistant ID (updated on message send) */
  assistantId?: string | null
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
  /** Cache expiration reminder toggle */
  enableCacheReminder?: boolean
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Last update timestamp (ISO string) */
  updatedAt: string
}
