// Agent-agnostic streaming interface
// This interface should be implemented by all agent services

import { EventEmitter } from 'node:events'

import { GetAgentSessionResponse } from '@types'
import { UIMessageChunk } from 'ai'

// Generic agent stream event that works with any agent type
export interface AgentStreamEvent {
  type: 'chunk' | 'error' | 'complete'
  chunk?: UIMessageChunk // Standard AI SDK chunk for UI consumption
  rawAgentMessage?: any // Agent-specific raw message (SDKMessage for Claude Code, different for other agents)
  error?: Error
  agentResult?: any // Agent-specific result data
}

// Agent stream interface that all agents should implement
export interface AgentStream extends EventEmitter {
  emit(event: 'data', data: AgentStreamEvent): boolean
  on(event: 'data', listener: (data: AgentStreamEvent) => void): this
  once(event: 'data', listener: (data: AgentStreamEvent) => void): this
}

// Base agent service interface
export interface AgentServiceInterface {
  invoke(prompt: string, session: GetAgentSessionResponse, lastAgentSessionId?: string): Promise<AgentStream>
}
