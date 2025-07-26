import Anthropic from '@anthropic-ai/sdk'
import {
  Base64ImageSource,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  WebSearchTool20250305
} from '@anthropic-ai/sdk/resources'
import {
  ContentBlock,
  ContentBlockParam,
  MessageCreateParams,
  MessageCreateParamsBase,
  RedactedThinkingBlockParam,
  ServerToolUseBlockParam,
  ThinkingBlockParam,
  ThinkingConfigParam,
  ToolUnion,
  ToolUseBlockParam,
  WebSearchResultBlock,
  WebSearchToolResultBlockParam,
  WebSearchToolResultError
} from '@anthropic-ai/sdk/resources/messages'
import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import AnthropicVertex from '@anthropic-ai/vertex-sdk'
import { loggerService } from '@logger'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { findTokenLimit, isClaudeReasoningModel, isReasoningModel, isWebSearchModel } from '@renderer/config/models'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  Assistant,
  EFFORT_RATIO,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse,
  WebSearchSource
} from '@renderer/types'
import {
  ChunkType,
  ErrorChunk,
  LLMWebSearchCompleteChunk,
  LLMWebSearchInProgressChunk,
  MCPToolCreatedChunk,
  TextDeltaChunk,
  TextStartChunk,
  ThinkingDeltaChunk,
  ThinkingStartChunk
} from '@renderer/types/chunk'
import { type Message } from '@renderer/types/newMessage'
import {
  AnthropicSdkMessageParam,
  AnthropicSdkParams,
  AnthropicSdkRawChunk,
  AnthropicSdkRawOutput
} from '@renderer/types/sdk'
import { addImageFileToContents } from '@renderer/utils/formats'
import {
  anthropicToolUseToMcpTool,
  isEnabledToolUse,
  mcpToolCallResponseToAnthropicMessage,
  mcpToolsToAnthropicTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'

import { BaseApiClient } from '../BaseApiClient'
import { AnthropicStreamListener, RawStreamListener, RequestTransformer, ResponseChunkTransformer } from '../types'

const logger = loggerService.withContext('AnthropicAPIClient')

export class AnthropicAPIClient extends BaseApiClient<
  Anthropic | AnthropicVertex,
  AnthropicSdkParams,
  AnthropicSdkRawOutput,
  AnthropicSdkRawChunk,
  AnthropicSdkMessageParam,
  ToolUseBlock,
  ToolUnion
> {
  sdkInstance: Anthropic | AnthropicVertex | undefined = undefined
  constructor(provider: Provider) {
    super(provider)
  }

  async getSdkInstance(): Promise<Anthropic | AnthropicVertex> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }
    this.sdkInstance = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.getBaseURL(),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19',
        ...this.provider.extra_headers
      }
    })
    return this.sdkInstance
  }

  override async createCompletions(
    payload: AnthropicSdkParams,
    options?: Anthropic.RequestOptions
  ): Promise<AnthropicSdkRawOutput> {
    const sdk = (await this.getSdkInstance()) as Anthropic
    if (payload.stream) {
      return sdk.messages.stream(payload, options)
    }
    return await sdk.messages.create(payload, options)
  }

  // @ts-ignore sdk未提供
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async generateImage(generateImageParams: GenerateImageParams): Promise<string[]> {
    return []
  }

  override async listModels(): Promise<Anthropic.ModelInfo[]> {
    const sdk = (await this.getSdkInstance()) as Anthropic
    const response = await sdk.models.list()
    return response.data
  }

  // @ts-ignore sdk未提供
  override async getEmbeddingDimensions(): Promise<number> {
    throw new Error("Anthropic SDK doesn't support getEmbeddingDimensions method.")
  }

  override getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
      return undefined
    }
    return assistant.settings?.temperature
  }

  override getTopP(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isClaudeReasoningModel(model)) {
      return undefined
    }
    return assistant.settings?.topP
  }

  /**
   * Get the reasoning effort
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning effort
   */
  private getBudgetToken(assistant: Assistant, model: Model): ThinkingConfigParam | undefined {
    if (!isReasoningModel(model)) {
      return undefined
    }
    const { maxTokens } = getAssistantSettings(assistant)

    const reasoningEffort = assistant?.settings?.reasoning_effort

    if (reasoningEffort === undefined) {
      return {
        type: 'disabled'
      }
    }

    const effortRatio = EFFORT_RATIO[reasoningEffort]

    const budgetTokens = Math.max(
      1024,
      Math.floor(
        Math.min(
          (findTokenLimit(model.id)?.max! - findTokenLimit(model.id)?.min!) * effortRatio +
            findTokenLimit(model.id)?.min!,
          (maxTokens || DEFAULT_MAX_TOKENS) * effortRatio
        )
      )
    )

    return {
      type: 'enabled',
      budget_tokens: budgetTokens
    }
  }

  /**
   * Get the message parameter
   * @param message - The message
   * @param model - The model
   * @returns The message parameter
   */
  public async convertMessageToSdkParam(message: Message): Promise<AnthropicSdkMessageParam> {
    const parts: MessageParam['content'] = [
      {
        type: 'text',
        text: await this.getMessageContent(message)
      }
    ]

    // Get and process image blocks
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        // Handle uploaded file
        const file = imageBlock.file
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          type: 'image',
          source: {
            data: base64Data.base64,
            media_type: base64Data.mime.replace('jpg', 'jpeg') as any,
            type: 'base64'
          }
        })
      }
    }
    // Get and process file blocks
    const fileBlocks = findFileBlocks(message)
    for (const fileBlock of fileBlocks) {
      const { file } = fileBlock
      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        if (file.ext === '.pdf' && file.size < 32 * 1024 * 1024) {
          const base64Data = await FileManager.readBase64File(file)
          parts.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data
            }
          })
        } else {
          const fileContent = await (await window.api.file.read(file.id + file.ext, true)).trim()
          parts.push({
            type: 'text',
            text: file.origin_name + '\n' + fileContent
          })
        }
      }
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): ToolUnion[] {
    return mcpToolsToAnthropicTools(mcpTools)
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): AnthropicSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      return mcpToolCallResponseToAnthropicMessage(mcpToolResponse, resp, model)
    } else if ('toolCallId' in mcpToolResponse) {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: mcpToolResponse.toolCallId!,
            content: resp.content
              .map((item) => {
                if (item.type === 'text') {
                  return {
                    type: 'text',
                    text: item.text || ''
                  } satisfies TextBlockParam
                }
                if (item.type === 'image') {
                  return {
                    type: 'image',
                    source: {
                      data: item.data || '',
                      media_type: (item.mimeType || 'image/png') as Base64ImageSource['media_type'],
                      type: 'base64'
                    }
                  } satisfies ImageBlockParam
                }
                return
              })
              .filter((n) => typeof n !== 'undefined'),
            is_error: resp.isError
          } satisfies ToolResultBlockParam
        ]
      }
    }
    return
  }

  // Implementing abstract methods from BaseApiClient
  convertSdkToolCallToMcp(toolCall: ToolUseBlock, mcpTools: MCPTool[]): MCPTool | undefined {
    // Based on anthropicToolUseToMcpTool logic in AnthropicProvider
    // This might need adjustment based on how tool calls are specifically handled in the new structure
    const mcpTool = anthropicToolUseToMcpTool(mcpTools, toolCall)
    return mcpTool
  }

  convertSdkToolCallToMcpToolResponse(toolCall: ToolUseBlock, mcpTool: MCPTool): ToolCallResponse {
    return {
      id: toolCall.id,
      toolCallId: toolCall.id,
      tool: mcpTool,
      arguments: toolCall.input as Record<string, unknown>,
      status: 'pending'
    } as ToolCallResponse
  }

  override buildSdkMessages(
    currentReqMessages: AnthropicSdkMessageParam[],
    output: Anthropic.Message,
    toolResults: AnthropicSdkMessageParam[]
  ): AnthropicSdkMessageParam[] {
    const assistantMessage: AnthropicSdkMessageParam = {
      role: output.role,
      content: convertContentBlocksToParams(output.content)
    }

    const newMessages: AnthropicSdkMessageParam[] = [...currentReqMessages, assistantMessage]
    if (toolResults && toolResults.length > 0) {
      newMessages.push(...toolResults)
    }
    return newMessages
  }

  override estimateMessageTokens(message: AnthropicSdkMessageParam): number {
    if (typeof message.content === 'string') {
      return estimateTextTokens(message.content)
    }
    return message.content
      .map((content) => {
        switch (content.type) {
          case 'text':
            return estimateTextTokens(content.text)
          case 'image':
            if (content.source.type === 'base64') {
              return estimateTextTokens(content.source.data)
            } else {
              return estimateTextTokens(content.source.url)
            }
          case 'tool_use':
            return estimateTextTokens(JSON.stringify(content.input))
          case 'tool_result':
            return estimateTextTokens(JSON.stringify(content.content))
          default:
            return 0
        }
      })
      .reduce((acc, curr) => acc + curr, 0)
  }

  public buildAssistantMessage(message: Anthropic.Message): AnthropicSdkMessageParam {
    const messageParam: AnthropicSdkMessageParam = {
      role: message.role,
      content: convertContentBlocksToParams(message.content)
    }
    return messageParam
  }

  public extractMessagesFromSdkPayload(sdkPayload: AnthropicSdkParams): AnthropicSdkMessageParam[] {
    return sdkPayload.messages || []
  }

  /**
   * Anthropic专用的原始流监听器
   * 处理MessageStream对象的特定事件
   */
  attachRawStreamListener(
    rawOutput: AnthropicSdkRawOutput,
    listener: RawStreamListener<AnthropicSdkRawChunk>
  ): AnthropicSdkRawOutput {
    logger.debug(`Attaching stream listener to raw output`)
    // 专用的Anthropic事件处理
    const anthropicListener = listener as AnthropicStreamListener
    // 检查是否为MessageStream
    if (rawOutput instanceof MessageStream) {
      logger.debug(`Detected Anthropic MessageStream, attaching specialized listener`)

      if (listener.onStart) {
        listener.onStart()
      }

      if (listener.onChunk) {
        rawOutput.on('streamEvent', (event: AnthropicSdkRawChunk) => {
          listener.onChunk!(event)
        })
      }

      if (anthropicListener.onContentBlock) {
        rawOutput.on('contentBlock', anthropicListener.onContentBlock)
      }

      if (anthropicListener.onMessage) {
        rawOutput.on('finalMessage', anthropicListener.onMessage)
      }

      if (listener.onEnd) {
        rawOutput.on('end', () => {
          listener.onEnd!()
        })
      }

      if (listener.onError) {
        rawOutput.on('error', (error: Error) => {
          listener.onError!(error)
        })
      }

      return rawOutput
    }

    if (anthropicListener.onMessage) {
      anthropicListener.onMessage(rawOutput)
    }

    // 对于非MessageStream响应
    return rawOutput
  }

  private async getWebSearchParams(model: Model): Promise<WebSearchTool20250305 | undefined> {
    if (!isWebSearchModel(model)) {
      return undefined
    }
    return {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5
    } as WebSearchTool20250305
  }

  getRequestTransformer(): RequestTransformer<AnthropicSdkParams, AnthropicSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: AnthropicSdkParams
        messages: AnthropicSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput, enableWebSearch } = coreRequest
        // 1. 处理系统消息
        const systemPrompt = assistant.prompt

        // 2. 设置工具
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        const systemMessage: TextBlockParam | undefined = systemPrompt
          ? { type: 'text', text: systemPrompt }
          : undefined

        // 3. 处理用户消息
        const sdkMessages: AnthropicSdkMessageParam[] = []
        if (typeof messages === 'string') {
          sdkMessages.push({ role: 'user', content: messages })
        } else {
          const processedMessages = addImageFileToContents(messages)
          for (const message of processedMessages) {
            sdkMessages.push(await this.convertMessageToSdkParam(message))
          }
        }

        if (enableWebSearch) {
          const webSearchTool = await this.getWebSearchParams(model)
          if (webSearchTool) {
            tools.push(webSearchTool)
          }
        }

        const commonParams: MessageCreateParamsBase = {
          model: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : sdkMessages,
          max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          system: systemMessage ? [systemMessage] : undefined,
          thinking: this.getBudgetToken(assistant, model),
          tools: tools.length > 0 ? tools : undefined,
          // 只在对话场景下应用自定义参数，避免影响翻译、总结等其他业务逻辑
          ...(coreRequest.callType === 'chat' ? this.getCustomParameters(assistant) : {})
        }

        const finalParams: MessageCreateParams = streamOutput
          ? {
              ...commonParams,
              stream: true
            }
          : {
              ...commonParams,
              stream: false
            }

        const timeout = this.getTimeout(model)
        return { payload: finalParams, messages: sdkMessages, metadata: { timeout } }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<AnthropicSdkRawChunk> {
    return () => {
      let accumulatedJson = ''
      const toolCalls: Record<number, ToolUseBlock> = {}
      return {
        async transform(rawChunk: AnthropicSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
          switch (rawChunk.type) {
            case 'message': {
              let i = 0
              let hasTextContent = false
              let hasThinkingContent = false

              for (const content of rawChunk.content) {
                switch (content.type) {
                  case 'text': {
                    if (!hasTextContent) {
                      controller.enqueue({
                        type: ChunkType.TEXT_START
                      } as TextStartChunk)
                      hasTextContent = true
                    }
                    controller.enqueue({
                      type: ChunkType.TEXT_DELTA,
                      text: content.text
                    } as TextDeltaChunk)
                    break
                  }
                  case 'tool_use': {
                    toolCalls[i] = content
                    i++
                    break
                  }
                  case 'thinking': {
                    if (!hasThinkingContent) {
                      controller.enqueue({
                        type: ChunkType.THINKING_START
                      } as ThinkingStartChunk)
                      hasThinkingContent = true
                    }
                    controller.enqueue({
                      type: ChunkType.THINKING_DELTA,
                      text: content.thinking
                    } as ThinkingDeltaChunk)
                    break
                  }
                  case 'web_search_tool_result': {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                      llm_web_search: {
                        results: content.content,
                        source: WebSearchSource.ANTHROPIC
                      }
                    } as LLMWebSearchCompleteChunk)
                    break
                  }
                }
              }
              if (i > 0) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: Object.values(toolCalls)
                } as MCPToolCreatedChunk)
              }
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: rawChunk.usage.input_tokens || 0,
                    completion_tokens: rawChunk.usage.output_tokens || 0,
                    total_tokens: (rawChunk.usage.input_tokens || 0) + (rawChunk.usage.output_tokens || 0)
                  }
                }
              })
              break
            }
            case 'content_block_start': {
              const contentBlock = rawChunk.content_block
              switch (contentBlock.type) {
                case 'server_tool_use': {
                  if (contentBlock.name === 'web_search') {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                    } as LLMWebSearchInProgressChunk)
                  }
                  break
                }
                case 'web_search_tool_result': {
                  if (
                    contentBlock.content &&
                    (contentBlock.content as WebSearchToolResultError).type === 'web_search_tool_result_error'
                  ) {
                    controller.enqueue({
                      type: ChunkType.ERROR,
                      error: {
                        code: (contentBlock.content as WebSearchToolResultError).error_code,
                        message: (contentBlock.content as WebSearchToolResultError).error_code
                      }
                    } as ErrorChunk)
                  } else {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                      llm_web_search: {
                        results: contentBlock.content as Array<WebSearchResultBlock>,
                        source: WebSearchSource.ANTHROPIC
                      }
                    } as LLMWebSearchCompleteChunk)
                  }
                  break
                }
                case 'tool_use': {
                  toolCalls[rawChunk.index] = contentBlock
                  break
                }
                case 'text': {
                  controller.enqueue({
                    type: ChunkType.TEXT_START
                  } as TextStartChunk)
                  break
                }
                case 'thinking':
                case 'redacted_thinking': {
                  controller.enqueue({
                    type: ChunkType.THINKING_START
                  } as ThinkingStartChunk)
                  break
                }
              }
              break
            }
            case 'content_block_delta': {
              const messageDelta = rawChunk.delta
              switch (messageDelta.type) {
                case 'text_delta': {
                  if (messageDelta.text) {
                    controller.enqueue({
                      type: ChunkType.TEXT_DELTA,
                      text: messageDelta.text
                    } as TextDeltaChunk)
                  }
                  break
                }
                case 'thinking_delta': {
                  if (messageDelta.thinking) {
                    controller.enqueue({
                      type: ChunkType.THINKING_DELTA,
                      text: messageDelta.thinking
                    } as ThinkingDeltaChunk)
                  }
                  break
                }
                case 'input_json_delta': {
                  if (messageDelta.partial_json) {
                    accumulatedJson += messageDelta.partial_json
                  }
                  break
                }
              }
              break
            }
            case 'content_block_stop': {
              const toolCall = toolCalls[rawChunk.index]
              if (toolCall) {
                try {
                  toolCall.input = accumulatedJson ? JSON.parse(accumulatedJson) : {}
                  logger.debug(`Tool call id: ${toolCall.id}, accumulated json: ${accumulatedJson}`)
                  controller.enqueue({
                    type: ChunkType.MCP_TOOL_CREATED,
                    tool_calls: [toolCall]
                  } as MCPToolCreatedChunk)
                } catch (error) {
                  logger.error('Error parsing tool call input:', error as Error)
                }
              }
              break
            }
            case 'message_delta': {
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: rawChunk.usage.input_tokens || 0,
                    completion_tokens: rawChunk.usage.output_tokens || 0,
                    total_tokens: (rawChunk.usage.input_tokens || 0) + (rawChunk.usage.output_tokens || 0)
                  }
                }
              })
            }
          }
        }
      }
    }
  }
}

/**
 * 将 ContentBlock 数组转换为 ContentBlockParam 数组
 * 去除服务器生成的额外字段，只保留发送给API所需的字段
 */
function convertContentBlocksToParams(contentBlocks: ContentBlock[]): ContentBlockParam[] {
  return contentBlocks.map((block): ContentBlockParam => {
    switch (block.type) {
      case 'text':
        // TextBlock -> TextBlockParam，去除 citations 等服务器字段
        return {
          type: 'text',
          text: block.text
        } satisfies TextBlockParam
      case 'tool_use':
        // ToolUseBlock -> ToolUseBlockParam
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input
        } satisfies ToolUseBlockParam
      case 'thinking':
        // ThinkingBlock -> ThinkingBlockParam
        return {
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature
        } satisfies ThinkingBlockParam
      case 'redacted_thinking':
        // RedactedThinkingBlock -> RedactedThinkingBlockParam
        return {
          type: 'redacted_thinking',
          data: block.data
        } satisfies RedactedThinkingBlockParam
      case 'server_tool_use':
        // ServerToolUseBlock -> ServerToolUseBlockParam
        return {
          type: 'server_tool_use',
          id: block.id,
          name: block.name,
          input: block.input
        } satisfies ServerToolUseBlockParam
      case 'web_search_tool_result':
        // WebSearchToolResultBlock -> WebSearchToolResultBlockParam
        return {
          type: 'web_search_tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content
        } satisfies WebSearchToolResultBlockParam
      default:
        return block as ContentBlockParam
    }
  })
}
