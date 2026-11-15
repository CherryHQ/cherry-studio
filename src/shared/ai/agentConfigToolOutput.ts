import * as z from 'zod'

const resultShape = {
  ok: z.literal(true),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  /** What was set (create) or `field: current → new` (update), in the app language. */
  summary: z.array(z.string()),
  /** Create only: the model and a key setting or two, short enough for the card's chips. */
  highlights: z.array(z.string()).optional()
}

/** What the Agent create and configure tools return; the renderer draws the identity card from it. */
export const AgentConfigToolOutputSchema = z.object({ ...resultShape, kind: z.literal('agent'), agentId: z.string() })
export type AgentConfigToolOutput = z.infer<typeof AgentConfigToolOutputSchema>

export const AssistantCreateToolOutputSchema = z.object({
  ...resultShape,
  kind: z.literal('assistant'),
  assistantId: z.string()
})
export type AssistantCreateToolOutput = z.infer<typeof AssistantCreateToolOutputSchema>
