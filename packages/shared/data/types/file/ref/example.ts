/**
 * Placeholder FileRef variant for development/testing.
 * Replace with real business integrations (e.g. chat_message, knowledge_item)
 * in Phase 2. Also serves as a template for adding new sourceType variants.
 */
import * as z from 'zod'

import { createRefSchema } from './essential'

export const exampleSourceType = 'example' as const

export const exampleRoles = ['role'] as const

export const exampleFileRefSchema = createRefSchema({
  sourceType: z.literal(exampleSourceType),
  sourceId: z.uuidv4(),
  role: z.enum(exampleRoles)
})
