import type { JSONSchema7 } from '@ai-sdk/provider'

import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

import type { ChatModelRuntime } from '../../catalog/types'

/** `code` of the error a generation fails with when the prompt does not fit the model's context. */
export const LLM_CONTEXT_OVERFLOW = 'context_overflow'

export interface LlmToolCall {
  name: string
  params: unknown
}

export interface LlmTool {
  name: string
  description?: string
  parameters: JSONSchema7
}

/** A conversation turn, already flattened from the AI SDK prompt in the main process. */
export type LlmChatMessage =
  | { role: 'system'; text: string }
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: Array<LlmToolCall & { result: unknown }> }

export interface LlmGenerateInput {
  messages: LlmChatMessage[]
  tools?: LlmTool[]
  thinking: boolean
  maxOutputTokens?: number
  sampling?: Partial<ChatModelRuntime['sampling']>
}

export type LlmGenerateEvent = { type: 'text' | 'reasoning'; delta: string }

export interface LlmGenerateResult {
  finishReason: 'stop' | 'length' | 'tool-calls' | 'other'
  toolCalls?: LlmToolCall[]
  usage: { inputTokens: number; outputTokens: number }
}

export type LlmInferenceContract = {
  methods: {
    generate: UtilityProcessMethod<
      LlmGenerateInput & { modelPath: string; runtime: ChatModelRuntime },
      LlmGenerateResult,
      LlmGenerateEvent
    >
  }
}

export interface LlmInitData {
  appPath: string
  /** Directory holding the node-llama-cpp `<platform>/llama-addon.node` folders. */
  binsDir: string
}
