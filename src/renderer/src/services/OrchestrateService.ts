import { Assistant, Message } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'

import { fetchChatCompletion } from './ApiService'
import { ConversationService } from './ConversationService'

/**
 * The request object for handling a user message.
 */
export interface OrchestrationRequest {
  messages: Message[]
  assistant: Assistant
  options: {
    signal?: AbortSignal
    timeout?: number
    headers?: Record<string, string>
  }
}

/**
 * The OrchestrationService is responsible for orchestrating the different services
 * to handle a user's message. It contains the core logic of the application.
 */
export class OrchestrationService {
  constructor() {
    // In the future, this could be a singleton, but for now, a new instance is fine.
    // this.conversationService = new ConversationService()
  }

  /**
   * This is the core method to handle user messages.
   * It takes the message context and an events object for callbacks,
   * and orchestrates the call to the LLM.
   * The logic is moved from `messageThunk.ts`.
   * @param request The orchestration request containing messages and assistant info.
   * @param events A set of callbacks to report progress and results to the UI layer.
   */
  async handleUserMessage(request: OrchestrationRequest, onChunkReceived: (chunk: Chunk) => void) {
    const { messages, assistant } = request

    try {
      const llmMessages = await ConversationService.prepareMessagesForLlm(messages, assistant)

      await fetchChatCompletion({
        messages: llmMessages,
        assistant: assistant,
        options: request.options,
        onChunkReceived
      })
    } catch (error: any) {
      onChunkReceived({ type: ChunkType.ERROR, error })
    }
  }
}
