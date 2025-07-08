import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { Message } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import {
  CitationMessageBlock,
  CodeMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  ThinkingMessageBlock,
  ToolMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import {
  LangfuseSettings,
  MessageTraceStartSpec as MessageTraceStartSpec,
  MessageTraceStopSpec as MessageTraceStopSpec,
  ObservationStartSpec as ObservationStartSpec,
  ObservationStopSpec as ObservationStopSpec,
  TraceProviderType
} from '@renderer/types/trace'
import {
  findFileBlocks,
  findImageBlocks,
  getErrorContent,
  getMainTextContent,
  getThinkingContent
} from '@renderer/utils/messageUtils/find'
import { Langfuse, LangfuseGenerationClient, LangfuseSpanClient, LangfuseTraceClient } from 'langfuse'

import BaseTraceProvider from './BaseTraceProvider'

type LangfuseMessageContent =
  | Array<{
      type: 'text' | 'image_url'
      text?: string
      image_url?: { url: string }
    }>
  | string
  | object

type LangfuseMessage = {
  role: 'user' | 'assistant' | 'system'
  content: LangfuseMessageContent
}

type LangfuseResponse = {
  output: {
    content: LangfuseMessageContent
    thinking?: string
    [key: string]: any
  }
  input?: {
    [key: string]: any
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
  name?: string
  level?: 'DEFAULT' | 'ERROR'
  statusMessage?: string
}

type TraceData = {
  client: LangfuseTraceClient
  model: string
  generation: LangfuseGenerationClient
  observations: Map<string, LangfuseSpanClient>
}

/**
 * Trace 用于追踪单条消息，和其中一个 generation 同步。
 * Trace 内的 observations 用于追踪消息块（或者消息的不同阶段）。
 */
export default class LangfuseProvider extends BaseTraceProvider {
  protected langfuse: Langfuse
  protected settings: LangfuseSettings
  protected traces: Map<string, TraceData> = new Map()

  constructor(provider: TraceProviderType) {
    super(provider)

    this.settings = store.getState().trace.langfuse
    this.langfuse = new Langfuse({
      baseUrl: this.settings.baseUrl,
      publicKey: this.settings.publicKey,
      secretKey: this.settings.secretKey
    })
  }

  public async startTrace(spec: MessageTraceStartSpec): Promise<void> {
    if (this.traces.has(spec.id)) {
      throw new Error(`[Langfuse] Trace with id ${spec.id} already exists, skipping...`)
    }

    const formattedMessages = await this.formatContext(spec?.messages ?? [])

    // 创建 trace
    const client = this.langfuse.trace({
      name: spec?.name ?? 'CherryStudio.Message',
      input: formattedMessages,
      sessionId: spec?.sessionId,
      tags: spec?.tags,
      version: spec?.version
    })

    const trace = {
      client,
      model: spec?.model ?? '',
      generation: client.generation({
        name: spec?.name ?? 'message',
        input: formattedMessages,
        model: spec?.model ?? ''
      }),
      observations: new Map()
    }

    this.traces.set(spec.id, trace)
  }

  public async stopTrace(spec: MessageTraceStopSpec): Promise<void> {
    const trace = this.traces.get(spec.id)
    if (!trace) {
      throw new Error(`[Langfuse] Cannot stop trace before it is started, id: ${spec.id}`)
    }

    this.traces.delete(spec.id)

    // 获取消息的最新状态
    const message = store.getState().messages.entities[spec.id]
    if (!message) {
      throw new Error(`[Langfuse] Failed to stop trace ${spec.id} because message with id ${spec.id} not found`)
    }

    const formattedResponse = await this.formatResponse(message)

    trace.generation.end({
      ...formattedResponse
    })

    trace.client.update({
      ...formattedResponse
    })
  }

  public async startObservation(spec: ObservationStartSpec): Promise<void> {
    const trace = this.traces.get(spec?.parentId ?? '')
    if (!trace) {
      throw new Error(`[Langfuse] Cannot start observation before trace is created, traceId: ${spec?.parentId}`)
    }

    if (trace.observations.has(spec.id)) {
      throw new Error(`[Langfuse] Observation with id ${spec.id} already exists, skipping...`)
    }

    // 获取消息块的最新状态
    const block = messageBlocksSelectors.selectById(store.getState(), spec.id)
    if (!block) {
      throw new Error(`[Langfuse] Failed to start observation ${spec.id} because block with id ${spec.id} not found`)
    }

    const span = trace.client.span({
      id: spec.id,
      name: block.type
    })

    trace.observations.set(spec.id, span)
  }

  public async stopObservation(spec: ObservationStopSpec): Promise<void> {
    const trace = this.traces.get(spec.parentId)
    if (!trace) {
      throw new Error(`[Langfuse] Cannot stop observation before it is started, id: ${spec.parentId}`)
    }

    const span = trace.observations.get(spec.id)
    if (!span) {
      throw new Error(`[Langfuse] Observation ${spec.id} not found`)
    }

    trace.observations.delete(spec.id)

    // 获取消息块的最新状态
    const block = messageBlocksSelectors.selectById(store.getState(), spec.id)
    if (!block) {
      span.end({
        name: 'block-deleted',
        output: { status: 'deleted' }
      })
    } else {
      const formattedResponse = this.formatMessageBlock(block)
      span.end({
        name: block.type,
        ...formattedResponse
      })
    }
  }

  /**
   * 关闭 langfuse 之前先检查还有没有未完成的 traces 和 observations。
   * 如果还有，只能假设它们不会正常结束了。
   */
  public async close(): Promise<void> {
    const response = {
      output: { content: null },
      level: 'ERROR' as const,
      statusMessage:
        'This trace or observation was not finished properly and was force closed during provider shutdown.'
    }

    for (const [traceId, trace] of this.traces) {
      // 清理 observations
      for (const [observationId, span] of trace.observations) {
        span.end({ name: 'block-incomplete', ...response })
        console.debug(`[Langfuse] Force closed observation ${observationId}`)
      }
      trace.observations.clear()

      // 清理 trace 和 generation
      trace.generation.end({ name: 'generation-incomplete', ...response })
      trace.client.update({ name: 'message-incomplete', ...response })
      console.debug(`[Langfuse] Force closed trace ${traceId}`)
    }

    this.traces.clear()

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

  private formatMessageBlock(block: MessageBlock): LangfuseResponse {
    const result: any = {
      level: block.status === MessageBlockStatus.ERROR ? 'ERROR' : 'DEFAULT',
      output: {
        content: '' // 默认内容，会在下面的switch中覆盖
      },
      metadata: {
        status: block.status,
        ...(block.metadata || {})
      }
    }

    if (block.model) {
      result.metadata.model = {
        id: block.model.id,
        name: block.model.name
      }
    }

    switch (block.type) {
      case MessageBlockType.MAIN_TEXT: {
        const mainBlock = block as MainTextMessageBlock
        result.output = { content: mainBlock.content }
        result.metadata.citationsCount = mainBlock.citationReferences?.length || 0
        result.metadata.hasKnowledgeBase = !!mainBlock.knowledgeBaseIds?.length
        result.metadata.knowledgeBaseIds = mainBlock.knowledgeBaseIds || []
        break
      }

      case MessageBlockType.THINKING: {
        const thinkingBlock = block as ThinkingMessageBlock
        result.output = { content: thinkingBlock.content }
        if (thinkingBlock.thinking_millsec !== undefined) {
          result.metadata.thinking_millsec = thinkingBlock.thinking_millsec
        }
        break
      }

      case MessageBlockType.TRANSLATION: {
        const translationBlock = block as TranslationMessageBlock
        result.output = { content: translationBlock.content }
        result.metadata.sourceLanguage = translationBlock.sourceLanguage
        result.metadata.targetLanguage = translationBlock.targetLanguage
        result.metadata.sourceBlockId = translationBlock.sourceBlockId
        break
      }

      case MessageBlockType.CODE: {
        const codeBlock = block as CodeMessageBlock
        result.output = { content: codeBlock.content }
        result.metadata.language = codeBlock.language
        result.metadata.linesCount = codeBlock.content?.split('\n').length || 0
        break
      }

      case MessageBlockType.TOOL: {
        const toolBlock = block as ToolMessageBlock
        if (typeof toolBlock.content === 'object') {
          result.output = { ...toolBlock.content }
        } else {
          result.output = { content: toolBlock.content }
        }
        result.input = {
          toolId: toolBlock.toolId,
          toolName: toolBlock.toolName,
          ...(toolBlock.arguments ?? {}),
          ...(toolBlock.metadata?.rawMcpToolResponse?.arguments ?? {})
        }
        result.metadata.success = toolBlock.status === MessageBlockStatus.SUCCESS
        result.metadata.responseType = typeof toolBlock.content
        break
      }

      case MessageBlockType.IMAGE: {
        const imageBlock = block as ImageMessageBlock
        result.output = {
          url: imageBlock.url,
          file: imageBlock.file
            ? {
                name: imageBlock.file.origin_name,
                type: imageBlock.file.type,
                size: imageBlock.file.size
              }
            : null
        }
        result.metadata.hasUrl = !!imageBlock.url
        result.metadata.hasFile = !!imageBlock.file
        result.metadata.generationSuccess = !!(imageBlock.url || imageBlock.file)
        result.metadata.prompt = imageBlock.metadata?.prompt
        break
      }

      case MessageBlockType.CITATION: {
        const citationBlock = block as CitationMessageBlock
        result.output = {
          searchResults: citationBlock.response?.results || [],
          knowledgeReferences: citationBlock.knowledge || []
        }
        // 安全地获取搜索结果数量
        const searchResults = citationBlock.response?.results
        result.metadata.searchResultsCount = Array.isArray(searchResults) ? searchResults.length : 0
        result.metadata.knowledgeReferencesCount = citationBlock.knowledge?.length || 0
        // 安全地获取查询和来源信息
        result.metadata.searchQuery = (citationBlock.response as any)?.query
        result.metadata.searchSource = citationBlock.response?.source
        break
      }

      case MessageBlockType.FILE: {
        const fileBlock = block as FileMessageBlock
        result.output = {
          fileName: fileBlock.file.origin_name,
          fileType: fileBlock.file.type,
          fileSize: fileBlock.file.size
        }
        result.metadata.fileName = fileBlock.file.origin_name
        result.metadata.fileType = fileBlock.file.type
        result.metadata.fileSize = fileBlock.file.size
        result.metadata.fileExtension = fileBlock.file.ext
        break
      }

      case MessageBlockType.ERROR: {
        const errorBlock = block as ErrorMessageBlock
        result.output = { content: errorBlock.error || 'Unknown error' }
        result.metadata.errorType = errorBlock.error?.name || 'unknown'
        result.metadata.hasStackTrace = !!errorBlock.error?.stack
        break
      }

      default:
        result.output = { content: (block as any).content || '' }
        break
    }

    return result
  }
}
