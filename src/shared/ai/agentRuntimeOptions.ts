import type { Model } from '@shared/data/types/model'
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

/** Clamp Work-agent runtime settings to the resolved model's capabilities. */
export function normalizeAgentRuntimeOptions(
  model: Model | undefined,
  options: Partial<AgentRuntimeOptions> | undefined
): AgentRuntimeOptions | undefined {
  if (!model || !options) return undefined
  const supportedEfforts = (model.reasoning?.supportedEfforts ?? []).filter((effort) =>
    AGENT_REASONING_EFFORTS.includes(effort)
  )
  if (supportedEfforts.length === 0) return undefined

  let reasoningEffort = options.reasoningEffort
  if (!reasoningEffort || !supportedEfforts.includes(reasoningEffort)) {
    const defaultEffort = model.reasoning?.defaultEffort
    if (defaultEffort && supportedEfforts.includes(defaultEffort)) {
      reasoningEffort = defaultEffort
    } else if (supportedEfforts.includes('medium')) {
      reasoningEffort = 'medium'
    } else if (supportedEfforts.includes('auto')) {
      reasoningEffort = 'auto'
    } else {
      const enabledEfforts = supportedEfforts.filter((effort) => effort !== 'none')
      reasoningEffort = enabledEfforts[Math.floor(enabledEfforts.length / 2)] ?? 'none'
    }
  }

  return {
    reasoningEffort,
    fastMode: options.fastMode === true && model.supportsFastMode === true
  }
}

export const AGENT_REASONING_EFFORT_HEADER = 'x-cherry-agent-reasoning-effort'
export const AGENT_FAST_MODE_HEADER = 'x-cherry-agent-fast-mode'
