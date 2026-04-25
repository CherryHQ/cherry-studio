/**
 * Topic entity types
 *
 * Topics are containers for messages. They reference the last-used assistant
 * and can be organized into groups.
 */

import * as z from 'zod'

export const TopicIdSchema = z.uuidv4()
export const TopicNameSchema = z.string().min(1).max(255)

/**
 * Complete topic entity as stored in database.
 */
export const TopicSchema = z.strictObject({
  /** Topic ID */
  id: TopicIdSchema,
  /** Topic name */
  name: TopicNameSchema.nullable().optional(),
  /** Whether the name was manually edited by user */
  isNameManuallyEdited: z.boolean(),
  /** Last-used assistant ID (updated on message send) */
  assistantId: z.string().nullable().optional(),
  /** Active node ID in the message tree */
  activeNodeId: z.string().nullable().optional(),
  /** Group ID for organization */
  groupId: z.string().nullable().optional(),
  /** Fractional-indexing order key, partitioned by groupId. */
  orderKey: z.string(),
  /** Creation timestamp (ISO string) */
  createdAt: z.iso.datetime(),
  /** Last update timestamp (ISO string) */
  updatedAt: z.iso.datetime()
})
export type Topic = z.infer<typeof TopicSchema>
