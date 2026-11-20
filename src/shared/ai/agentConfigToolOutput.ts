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

/** What a pending create or update would do, shown on its approval card before anything is written. */
export const AgentConfigChangePreviewSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    /** Update: `field: current → new` lines. */
    summary: z.array(z.string()).optional(),
    /** Update: long texts in full, behind the summary's shortened lines. */
    details: z.array(z.strictObject({ field: z.string(), from: z.string(), to: z.string() })).optional(),
    /** Create: the resource the call would make. */
    resource: z
      .strictObject({
        kind: z.enum(['agent', 'assistant']),
        name: z.string(),
        emoji: z.string(),
        description: z.string(),
        highlights: z.array(z.string())
      })
      .optional()
  }),
  z.strictObject({ ok: z.literal(false) })
])
export type AgentConfigChangePreview = z.infer<typeof AgentConfigChangePreviewSchema>
