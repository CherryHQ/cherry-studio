import { z } from 'zod'

// Schema
// =====================================================
export const ClarifyWithUserSchema = z
  .object({
    need_clarification: z.boolean().describe('Whether the query needs clarification from the user'),
    question: z.string().describe('question to ask the user to clarify the report scope'),
    verification: z.string().describe('verification message that we will start research')
  })
  .transform((r) => ({
    needClarification: r.need_clarification,
    question: r.question,
    verification: r.verification
  }))
export type ClarifyWithUserResponse = z.infer<typeof ClarifyWithUserSchema>

export const ResearchTopicsSchema = z.object({
  reflection: z.string().describe('thorough reflection on the research brief and current findings'),
  tasks: z.array(z.string()).describe('list of research tasks to explore'),
  fulfilled: z.boolean().describe('whether the research brief is fulfilled by the current findings')
})
export type ResearchTopicsResponse = z.infer<typeof ResearchTopicsSchema>
// =====================================================
