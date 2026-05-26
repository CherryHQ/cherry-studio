/**
 * Chat message file reference variant
 *
 * Links a FileEntry to a message row in the v2 chat subsystem. The owning
 * service writes refs when a message is created with file or image blocks.
 * The corresponding `chatMessageChecker` (in `orphanCheckerRegistry`) uses
 * the message DB table to determine liveness.
 *
 * ## sourceId format
 *
 * `sourceId` uses `MessageIdSchema = z.uuid()` (not `z.uuidv7()`) because
 * v1 legacy message IDs are UUIDv4 and are preserved verbatim during migration.
 * Both formats are valid UUIDs, so `z.uuid()` accepts both.
 *
 * ## Role
 *
 * `role` is `'attachment'` for both image blocks and file blocks — the single
 * meaningful relationship a file can have with a message at this stage.
 */

import * as z from 'zod'

import { MessageIdSchema } from '../../message'
import { createRefSchema } from './essential'

export const chatMessageSourceType = 'chat_message' as const

export const chatMessageRoles = ['attachment'] as const
export const chatMessageRoleSchema = z.enum(chatMessageRoles)

export const chatMessageRefFields = {
  sourceType: z.literal(chatMessageSourceType),
  sourceId: MessageIdSchema,
  role: chatMessageRoleSchema
}

export const chatMessageFileRefSchema = createRefSchema(chatMessageRefFields)
