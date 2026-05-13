/**
 * Temp session file reference variant
 *
 * Tracks transient FileEntry records (typically paste previews, draft attachments)
 * that are in use by a session and should be retained until the session completes.
 * Entries with no file_ref are eligible for cleanup per business policy.
 * Temp refs must be explicitly created and removed by the session owner.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const tempSessionSourceType = 'temp_session' as const

export const tempSessionRoles = ['pending'] as const

/** Business fields only (no common fields like id/nodeId/timestamps) */
export const tempSessionRefFields = {
  sourceType: z.literal(tempSessionSourceType),
  sourceId: z.string().min(1),
  role: z.enum(tempSessionRoles)
}

export const tempSessionFileRefSchema = createRefSchema(tempSessionRefFields)
