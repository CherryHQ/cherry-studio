import * as z from 'zod'

/** Model-specific message contracts; provider overrides take precedence. */
export const MessageCompatibilitySchema = z.object({
  thoughtSignatures: z.boolean().optional(),
  dynamicToolDeclarations: z.boolean().optional(),
  thinkingPrompt: z.boolean().optional(),
  translation: z.boolean().optional(),
  search: z.enum(['chat-options', 'deep-research']).optional(),
  interleavedThinkingBeta: z.boolean().optional(),
  vertexWebSearchBeta: z.boolean().optional()
})
export type MessageCompatibility = z.infer<typeof MessageCompatibilitySchema>
