import type { ReasoningEffortOption } from '../utils/reasoning'

export type AgentReasoningEffort = Extract<ReasoningEffortOption, 'low' | 'medium' | 'high' | 'xhigh'>

export interface AgentRuntimeOptions {
  reasoningEffort: AgentReasoningEffort
  fastMode: boolean
}

export const AGENT_REASONING_EFFORT_HEADER = 'x-cherry-agent-reasoning-effort'
export const AGENT_FAST_MODE_HEADER = 'x-cherry-agent-fast-mode'
