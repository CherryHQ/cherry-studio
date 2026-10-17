import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'

import type { ChatModelRuntime } from '../../catalog/types'

/** A conversation turn, already flattened from the AI SDK prompt in the main process. */
export type LlmChatMessage =
  | { role: 'system'; text: string }
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }

export interface LlmGenerateInput {
  messages: LlmChatMessage[]
  thinking: boolean
  maxOutputTokens?: number
  sampling?: Partial<ChatModelRuntime['sampling']>
}

export type LlmGenerateEvent = { type: 'text' | 'reasoning'; delta: string }

export interface LlmGenerateResult {
  finishReason: 'stop' | 'length' | 'other'
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
