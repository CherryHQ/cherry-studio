import { Assistant, Message } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { replacePromptVariables } from '@renderer/utils/prompt'

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
  topicId?: string // 添加 topicId 用于 trace
}

/**
 * The OrchestrationService is responsible for orchestrating the different services
 * to handle a user's message. It contains the core logic of the application.
 */
// NOTE：暂时没有用到这个类
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
  async transformMessagesAndFetch(request: OrchestrationRequest, onChunkReceived: (chunk: Chunk) => void) {
    const { messages, assistant } = request

    try {
      const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(messages, assistant)

      await fetchChatCompletion({
        messages: modelMessages,
        assistant: assistant,
        options: request.options,
        onChunkReceived,
        topicId: request.topicId,
        uiMessages: uiMessages
      })
    } catch (error: any) {
      onChunkReceived({ type: ChunkType.ERROR, error })
    }
  }
}

/**
 * 将用户消息转换为LLM可以理解的格式并发送请求
 * @param request - 包含消息内容和助手信息的请求对象
 * @param onChunkReceived - 接收流式响应数据的回调函数
 */
// 目前先按照函数来写,后续如果有需要到class的地方就改回来
export async function transformMessagesAndFetch(
  request: OrchestrationRequest,
  onChunkReceived: (chunk: Chunk) => void
) {
  const { messages, assistant } = request

  try {
    const { modelMessages, uiMessages } = await ConversationService.prepareMessagesForModel(messages, assistant)

    // replace prompt variables
    assistant.prompt = await replacePromptVariables(assistant.prompt, assistant.model?.name)

    await fetchChatCompletion({
      messages: modelMessages,
      assistant: assistant,
      options: request.options,
      onChunkReceived,
      topicId: request.topicId,
      uiMessages
    })
  } catch (error: any) {
    onChunkReceived({ type: ChunkType.ERROR, error })
  }
}
