import * as z from 'zod'

export const AgentHookEventSchema = z.enum([
  'sessionStart',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'questionRequested',
  'approvalRequested',
  'turnEnd'
])
export type AgentHookEvent = z.infer<typeof AgentHookEventSchema>

export const AgentHookSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().trim().max(100),
    event: AgentHookEventSchema,
    enabled: z.boolean(),
    command: z.string().max(16_384),
    matcher: z
      .strictObject({
        toolNameContains: z.string().max(256).optional(),
        inputContains: z.string().max(1000).optional()
      })
      .optional(),
    timeoutMs: z.number().int().min(100).max(60_000)
  })
  .refine((hook) => !hook.enabled || hook.command.trim().length > 0, { path: ['command'] })

export const AgentHookListSchema = z
  .array(AgentHookSchema)
  .max(16)
  .refine((hooks) => new Set(hooks.map((hook) => hook.id)).size === hooks.length)
export type AgentHook = z.infer<typeof AgentHookSchema>
