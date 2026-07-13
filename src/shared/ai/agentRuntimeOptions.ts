export const AGENT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number]

export interface AgentRuntimeOptions {
  reasoningEffort: AgentReasoningEffort
  fastMode: boolean
}

export const AGENT_REASONING_EFFORT_HEADER = 'x-cherry-agent-reasoning-effort'
export const AGENT_FAST_MODE_HEADER = 'x-cherry-agent-fast-mode'
