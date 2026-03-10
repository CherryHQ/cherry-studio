// Agent-agnostic streaming interface
// This interface should be implemented by all agent services

import type { EventEmitter } from 'node:events'

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

// Generic agent stream event that works with any agent type
export interface AgentStreamEvent {
  type: 'chunk' | 'error' | 'complete' | 'cancelled'
  chunk?: TextStreamPart<any> // Standard AI SDK chunk for UI consumption
  error?: Error
}

// Agent stream interface that all agents should implement
export interface AgentStream extends EventEmitter {
  emit(event: 'data', data: AgentStreamEvent): boolean
  on(event: 'data', listener: (data: AgentStreamEvent) => void): this
  once(event: 'data', listener: (data: AgentStreamEvent) => void): this
  /** SDK session_id captured from the init message, used for resume. */
  sdkSessionId?: string
}

export interface AgentThinkingOptions {
  effort?: Options['effort']
  thinking?: Options['thinking']
}

// Base agent service interface
export interface AgentServiceInterface {
  invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream>
}
