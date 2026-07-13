import * as z from 'zod'

export const AGENT_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'auto'
] as const

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number]

export interface AgentRuntimeOptions {
  reasoningEffort: AgentReasoningEffort
  fastMode: boolean
}

export const AgentRuntimeOptionsSchema = z.strictObject({
  reasoningEffort: z.enum(AGENT_REASONING_EFFORTS),
  fastMode: z.boolean()
}) satisfies z.ZodType<AgentRuntimeOptions>

export const AGENT_REASONING_EFFORT_HEADER = 'x-cherry-agent-reasoning-effort'
export const AGENT_FAST_MODE_HEADER = 'x-cherry-agent-fast-mode'
