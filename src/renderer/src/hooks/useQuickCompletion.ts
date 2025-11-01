import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant } from '@renderer/services/AssistantService'
import type { Assistant, FetchChatCompletionParams } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { useCallback } from 'react'

import { useDefaultModel } from './useAssistant'

/**
 * Parameters for performing a quick completion using the quick model.
 */
export type QuickCompletionParams = {
  /**
   * The user message text (not the system prompt) to send to the model.
   * The system prompt is set via the `systemPrompt` parameter passed to `useQuickCompletion`.
   */
  prompt: string
  /**
   * Callback invoked whenever a new chunk of the streaming response arrives.
   */
  onChunk: (chunk: Chunk) => void
  /**
   * Optional partial assistant settings to override the default quick assistant.
   */
  assistantUpdate?: Partial<Assistant>
  /**
   * Optional additional parameters to pass to the underlying fetchChatCompletion call.
   * Excludes prompt, messages, assistant, and onChunkReceived which are handled internally.
   */
  params?: Partial<Omit<FetchChatCompletionParams, 'prompt' | 'messages' | 'assistant' | 'onChunkReceived'>>
}

export const useQuickCompletion = (systemPrompt: string) => {
  const { quickModel } = useDefaultModel()

  const completion = useCallback(
    async ({ prompt, onChunk, assistantUpdate, params }: QuickCompletionParams) => {
      const assistant = {
        ...getDefaultAssistant(),
        prompt: systemPrompt,
        model: quickModel,
        ...assistantUpdate
      } satisfies Assistant
      return fetchChatCompletion({ prompt, assistant, onChunkReceived: onChunk, ...params })
    },
    [quickModel, systemPrompt]
  )

  return completion
}
