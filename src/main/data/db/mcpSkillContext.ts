import * as z from 'zod'

import { McpSkillEntrySchema } from '@shared/types/mcpSkills'

/** Private retained context; never returned as remote skill metadata. */
export const McpSkillContextSchema = McpSkillEntrySchema.extend({
  originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  invalidated: z.boolean()
})
export type McpSkillContext = z.infer<typeof McpSkillContextSchema>
