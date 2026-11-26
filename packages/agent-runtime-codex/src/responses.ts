import * as z from 'zod'

import type { CodexRequestParams } from './protocol'

const thread = z.object({
  thread: z.object({ id: z.string() }),
  model: z.string().optional(),
  approvalPolicy: z.unknown().optional(),
  sandbox: z.looseObject({ type: z.string().optional() }).optional(),
  collaborationMode: z.object({ mode: z.enum(['default', 'plan']) }).nullish(),
  reasoningEffort: z.string().nullish()
})
const model = z.looseObject({
  id: z.string(),
  model: z.string().optional(),
  displayName: z.string(),
  inputModalities: z.array(z.string()).optional(),
  supportedReasoningEfforts: z
    .array(z.looseObject({ reasoningEffort: z.string(), description: z.string().optional() }))
    .optional(),
  defaultReasoningEffort: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  context_window: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
  max_context_tokens: z.number().int().positive().optional()
})
const skill = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  path: z.string(),
  enabled: z.boolean().optional()
})
const empty = z.looseObject({})
const turn = z.looseObject({ id: z.string() })

const rateLimitWindow = z.object({
  usedPercent: z.number().nonnegative(),
  windowDurationMins: z.number().positive().nullish(),
  resetsAt: z.number().nonnegative().nullish()
})
const rateLimitSnapshot = z.object({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  primary: rateLimitWindow.nullish(),
  secondary: rateLimitWindow.nullish()
})
export const goalSchema = z.object({ threadId: z.string(), objective: z.string(), status: z.string() })
export const responses = {
  'model/list': z.looseObject({ data: z.array(model), nextCursor: z.string().nullish() }),
  'skills/list': z.looseObject({ data: z.array(z.looseObject({ skills: z.array(skill) })) }),
  'config/read': z.looseObject({
    config: z.looseObject({
      model_provider: z.string().nullish(),
      mcp_servers: z.record(z.string().regex(/^[\w-]+$/), z.unknown()).nullish()
    })
  }),
  'thread/start': thread,
  'thread/resume': thread,
  'thread/fork': thread,
  'thread/name/set': empty,
  'thread/compact/start': empty,
  'thread/revert': z.object({ thread: z.object({ id: z.string() }) }),
  'thread/turns/list': z.object({
    data: z
      .array(z.object({ id: z.string().min(1), status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']) }))
      .max(1)
  }),
  'collaborationMode/list': z.object({ data: z.array(z.object({ mode: z.string().nullish() })) }),
  'experimentalFeature/list': z.object({
    data: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
    nextCursor: z.string().nullish()
  }),
  'thread/goal/get': z.object({ goal: goalSchema.nullable() }),
  'thread/goal/set': z.object({ goal: goalSchema }),
  'thread/goal/clear': z.object({ cleared: z.boolean() }),
  'turn/steer': z.object({ turnId: z.string() }),
  'turn/start': z.looseObject({ turn }),
  'turn/interrupt': empty,
  'review/start': z.looseObject({ turn, reviewThreadId: z.string() }),
  'account/read': z.object({
    account: z.object({ type: z.string(), email: z.string().nullish() }).nullish(),
    requiresOpenaiAuth: z.boolean(),
    userId: z.string().nullish(),
    workspaceRouting: z.object({ chatgptAccountId: z.string() }).nullish()
  }),
  'account/rateLimits/read': z.object({
    accountId: z.string().nullish(),
    rateLimits: rateLimitSnapshot,
    rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshot).nullish()
  }),
  'account/usage/read': z.record(z.string(), z.unknown()),
  gitDiffToRemote: z.looseObject({ diff: z.string() }),
  'command/exec': z.looseObject({ stdout: z.string() }),
  'mcpServerStatus/list': z.looseObject({
    data: z.array(
      z.looseObject({
        name: z.string(),
        tools: z.record(z.string(), z.unknown()).optional(),
        authStatus: z.string().optional()
      })
    )
  })
} satisfies Record<Exclude<keyof CodexRequestParams, 'initialize'>, z.ZodType>
