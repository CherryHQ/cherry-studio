/**
 * Temp session file reference variant
 *
 * Tracks temporary files in the system_temp mount that are in use by a session.
 * Files in system_temp without any ref are eligible for automatic cleanup.
 * Temp refs must be explicitly created and removed by the session owner.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const tempSessionSourceType = 'temp_session' as const

export const tempSessionRoles = ['pending'] as const

export const tempSessionFileRefSchema = createRefSchema({
  sourceType: z.literal(tempSessionSourceType),
  sourceId: z.string().min(1),
  role: z.enum(tempSessionRoles)
})
