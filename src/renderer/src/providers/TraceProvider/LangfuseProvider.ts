import store from '@renderer/store'
import { Message } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import { BaseObservationSpec, BaseTraceSpec, LangfuseSettings, TraceProviderType } from '@renderer/types/trace'
import {
  findFileBlocks,
  findImageBlocks,
  getErrorContent,
  getMainTextContent,
  getThinkingContent
} from '@renderer/utils/messageUtils/find'
import { Langfuse, LangfuseGenerationClient, LangfuseTraceClient } from 'langfuse'

import BaseTraceProvider from './BaseTraceProvider'

type LangfuseMessageContent =
  | string
  | Array<{
      type: 'text' | 'image_url'
      text?: string
      image_url?: { url: string }
    }>

type LangfuseMessage = {
  role: 'user' | 'assistant' | 'system'
  content: LangfuseMessageContent
}

type LangfuseResponse = {
  output: {
    content: LangfuseMessageContent
    thinking?: string
  }
  modelParameters?: Record<string, any>
  usage?: {
    completionTokens?: number
    promptTokens?: number
    totalTokens?: number
  }
  startTime?: Date
  completionStartTime?: Date
  metadata?: Record<string, any>
  level?: 'DEFAULT' | 'ERROR'
  statusMessage?: string
}

export default class LangfuseProvider extends BaseTraceProvider {
  protected langfuse: Langfuse
  protected settings: LangfuseSettings
  protected trace: LangfuseTraceClient | null = null
  protected generation: LangfuseGenerationClient | null = null

  constructor(provider: TraceProviderType) {
    super(provider)

    this.settings = store.getState().trace.langfuse
    this.langfuse = new Langfuse({
      baseUrl: this.settings.baseUrl,
      publicKey: this.settings.publicKey,
      secretKey: this.settings.secretKey
    })
  }

  public async createTrace(contextMessages?: Message[], spec?: BaseTraceSpec): Promise<void> {
    const formattedMessages = await this.formatContext(contextMessages ?? [])

    this.trace = this.langfuse.trace({
      name: spec?.name ?? 'CherryStudio.Message',
      input: formattedMessages,
      ...spec
    })
  }

  public async startObservation(contextMessages: Message[], spec?: BaseObservationSpec): Promise<void> {
    if (!this.trace) {
      throw new Error('Cannot start observation before trace is created')
    }

    const formattedMessages = await this.formatContext(contextMessages)

    this.generation = this.trace.generation({
      name: 'chat-completion',
      input: formattedMessages,
      ...spec
    })
  }

  public async stopObservation(messageId: string): Promise<void> {
    if (!this.generation) {
      throw new Error('Cannot stop observation before it is started')
    }

    // 获取消息的最新状态
    const response = store.getState().messages.entities[messageId]

    if (!response) {
      throw new Error(`[Langfuse] Message with id ${messageId} not found`)
    }

    const formattedResponse = await this.formatResponse(response)

    this.generation.end({
      ...formattedResponse
    })

    this.trace?.update({
      ...formattedResponse
    })
  }

  public async close(): Promise<void> {
    return await this.langfuse.shutdownAsync()
  }

  /**
   * 将发送的Message数组转换为自定义格式
   */
  protected async formatContext(messages: Message[]): Promise<LangfuseMessage[]> {
    const formattedMessages: LangfuseMessage[] = []

    for (const message of messages) {
      const langfuseMessage = await this.formatMessage(message)
      formattedMessages.push(langfuseMessage)
    }

    return formattedMessages
  }

  /**
   * 将响应Message转换为自定义格式
   */
  protected async formatResponse(response: Message): Promise<LangfuseResponse> {
    if (response.status === 'error') {
      const errorContent = getErrorContent(response)
      return {
        output: {
          content: errorContent
        },
        level: 'ERROR',
        statusMessage: errorContent
      }
    }

    const mainContent = await this.formatMessage(response)

    const result: LangfuseResponse = {
      output: {
        content: mainContent.content
      }
    }

    // 添加思考内容
    const thinking = getThinkingContent(response)
    if (thinking) {
      result.output.thinking = thinking
    }

    // 获取消息关联的助手
    const assistant = store.getState().assistants.assistants.find((a) => a.id === response.assistantId)

    // 更新助手相关信息
    if (assistant?.settings) {
      result.modelParameters = {
        ...assistant.settings
      }
    }

    // 添加token使用信息
    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      }
    }

    // 初始化metadata对象
    result.metadata = {}

    // 添加基础元数据
    if (response.model) {
      result.metadata.model = response.model
      result.metadata.assistant_id = response.assistantId
      result.metadata.created_at = response.createdAt
    }

    // 集成额外性能指标
    if (response.metrics) {
      // 首个token时间
      const ttft = response.metrics.time_first_token_millsec
      if (ttft && ttft > 0) {
        result.metadata.time_to_first_token_ms = ttft

        // 计算 completionStartTime
        // FIXME: 这样处理之后，得到的 TTFT 和实际的可能有偏差
        const startTimeString = response.updatedAt ?? response.createdAt
        if (startTimeString) {
          const startTime = new Date(startTimeString)
          result.startTime = startTime
          result.completionStartTime = new Date(startTime.getTime() + ttft)
        }
      }

      // 完成时间
      const completionTime = response.metrics.time_completion_millsec
      if (completionTime && completionTime > 0) {
        result.metadata.completion_time_ms = completionTime
      }

      // 思考时间
      const thinkingTime = response.metrics.time_thinking_millsec
      if (thinkingTime && thinkingTime > 0) {
        result.metadata.thinking_time_ms = thinkingTime
      }

      // 计算tokens per second - 使用metrics中的completion_tokens或usage中的completion_tokens
      const completionTokens = response.metrics.completion_tokens || response.usage?.completion_tokens
      if (completionTokens && completionTokens > 0 && completionTime && completionTime > 0) {
        result.metadata.tokens_per_second = Math.round(completionTokens / (completionTime / 1000))
      }
    }

    return result
  }

  /**
   * 将单个Message转换为自定义Langfuse消息格式
   * FIXME: 要和实际发送内容保持一致，考虑复用
   */
  private async formatMessage(message: Message): Promise<LangfuseMessage> {
    const content = getMainTextContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    // 简单情况：只有文本内容
    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      return {
        role: message.role === 'system' ? 'user' : message.role,
        content
      }
    }

    // 复杂情况：多模态内容
    const parts: Array<{
      type: 'text' | 'image_url'
      text?: string
      image_url?: { url: string }
    }> = []

    if (content) {
      parts.push({ type: 'text', text: content })
    }

    // 处理图片
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
        parts.push({
          type: 'image_url',
          image_url: { url: image.data }
        })
      } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
        parts.push({
          type: 'image_url',
          image_url: { url: imageBlock.url }
        })
      }
    }

    // 处理文件（将文件内容作为文本添加）
    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (!file) continue

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          type: 'text',
          text: `File: ${file.origin_name}\n\n${fileContent}`
        })
      }
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }
}
