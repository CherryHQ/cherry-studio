// Web `agentRuntimeCapabilities.ts`: Pi is the only runtime, without the features the browser runtime leaves out.
import {
  AGENT_RUNTIME_CAPABILITIES as DESKTOP_CAPABILITIES,
  type AgentRuntimeCapabilities
} from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'

export type { AgentRuntimeCapabilities } from '@shared/ai/agentRuntimeCapabilities'

export const AGENT_RUNTIME_CAPABILITIES = {
  ...DESKTOP_CAPABILITIES,
  pi: {
    ...DESKTOP_CAPABILITIES.pi,
    heartbeat: false,
    knowledgeBases: false,
    mcp: false,
    skills: false,
    slashCommands: []
  }
} as const satisfies Record<AgentType, AgentRuntimeCapabilities>
