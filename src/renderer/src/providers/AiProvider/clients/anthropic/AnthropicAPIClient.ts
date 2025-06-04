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
  MessageCreateParams,
  MessageCreateParamsBase,
  ThinkingConfigParam,
  ToolUnion,
  WebSearchResultBlock,
  WebSearchToolResultError
} from '@anthropic-ai/sdk/resources/messages'
import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import Logger from '@renderer/config/logger'
import { findTokenLimit, isClaudeReasoningModel, isReasoningModel, isWebSearchModel } from '@renderer/config/models'
import { GenericChunk } from '@renderer/providers/middleware/schemas'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import FileManager from '@renderer/services/FileManager'
import {
  filterContextMessages,
  filterEmptyMessages,
  filterUserRoleStartMessages
} from '@renderer/services/MessagesService'
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
  ThinkingDeltaChunk
} from '@renderer/types/chunk'
import type { Message } from '@renderer/types/newMessage'
import {
  AnthropicSdkMessageParam,
  AnthropicSdkParams,
  AnthropicSdkRawChunk,
  AnthropicSdkRawOutput
} from '@renderer/types/sdk'
import {
  anthropicToolUseToMcpTool,
  isEnabledToolUse,
  mcpToolCallResponseToAnthropicMessage,
  mcpToolsToAnthropicTools
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { takeRight } from 'lodash'

import { BaseApiClient } from '../BaseApiClient'
import { AnthropicStreamListener, RawStreamListener, RequestTransformer, ResponseChunkTransformer } from '../types'

export class AnthropicAPIClient extends BaseApiClient<
  Anthropic,
  AnthropicSdkParams,
  AnthropicSdkRawOutput,
  AnthropicSdkRawChunk,
  AnthropicSdkMessageParam,
  ToolUseBlock,
  ToolUnion
> {
  constructor(provider: Provider) {
    super(provider)
  }

  async getSdkInstance(): Promise<Anthropic> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }
    this.sdkInstance = new Anthropic({
      apiKey: this.getApiKey(),
      baseURL: this.getBaseURL(),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19'
      }
    })
    return this.sdkInstance
  }

  override async createCompletions(
    payload: AnthropicSdkParams,
    options?: Anthropic.RequestOptions
  ): Promise<AnthropicSdkRawOutput> {
    const sdk = await this.getSdkInstance()
    return sdk.messages.stream(payload, options)
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
        text: getMainTextContent(message)
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
          const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
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
    toolResults: AnthropicSdkMessageParam[],
    assistantMessage: AnthropicSdkMessageParam,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _toolCalls?: ToolUseBlock[]
  ): AnthropicSdkMessageParam[] {
    const newMessages: AnthropicSdkMessageParam[] = [...currentReqMessages, assistantMessage]
    if (toolResults && toolResults.length > 0) {
      newMessages.push(...toolResults)
    }
    return newMessages
  }

  /**
   * Anthropic专用的原始流监听器
   * 处理MessageStream对象的特定事件
   */
  override attachRawStreamListener(
    rawOutput: AnthropicSdkRawOutput,
    listener: RawStreamListener<AnthropicSdkRawChunk>
  ): AnthropicSdkRawOutput {
    console.log(`[AnthropicApiClient] 附加流监听器到原始输出`)

    // 检查是否为MessageStream
    if (rawOutput instanceof MessageStream) {
      console.log(`[AnthropicApiClient] 检测到 Anthropic MessageStream，附加专用监听器`)

      if (listener.onStart) {
        listener.onStart()
      }

      if (listener.onChunk) {
        rawOutput.on('streamEvent', (event: AnthropicSdkRawChunk) => {
          listener.onChunk!(event)
        })
      }

      // 专用的Anthropic事件处理
      const anthropicListener = listener as AnthropicStreamListener

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
        processedMessages: Message[]
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput, enableWebSearch, onFilterMessages } = coreRequest

        const { contextCount } = getAssistantSettings(assistant)

        const _messages = filterUserRoleStartMessages(
          filterContextMessages(filterEmptyMessages(takeRight(messages, contextCount + 2)))
        )
        onFilterMessages(_messages)

        const sdkMessages: AnthropicSdkMessageParam[] = []
        for (const message of _messages) {
          sdkMessages.push(await this.convertMessageToSdkParam(message))
        }

        let systemPrompt = assistant.prompt

        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        if (this.useSystemPromptForTools && mcpTools && mcpTools.length) {
          systemPrompt = buildSystemPrompt(systemPrompt, mcpTools)
        }
        const systemMessage: TextBlockParam | undefined = systemPrompt
          ? { type: 'text', text: systemPrompt }
          : undefined

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
          ...this.getCustomParameters(assistant)
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
        return { payload: finalParams, messages: sdkMessages, processedMessages: _messages }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<AnthropicSdkRawChunk> {
    let accumulatedJson = ''
    const toolCalls: Record<number, ToolUseBlock> = {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return async function* (rawChunk: AnthropicSdkRawChunk, _context): AsyncGenerator<GenericChunk> {
      switch (rawChunk.type) {
        case 'content_block_start': {
          const contentBlock = rawChunk.content_block
          switch (contentBlock.type) {
            case 'server_tool_use': {
              if (contentBlock.name === 'web_search') {
                yield {
                  type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                } as LLMWebSearchInProgressChunk
              }
              break
            }
            case 'web_search_tool_result': {
              if (
                contentBlock.content &&
                (contentBlock.content as WebSearchToolResultError).type === 'web_search_tool_result_error'
              ) {
                yield {
                  type: ChunkType.ERROR,
                  error: {
                    code: (contentBlock.content as WebSearchToolResultError).error_code,
                    message: (contentBlock.content as WebSearchToolResultError).error_code
                  }
                } as ErrorChunk
              } else {
                yield {
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: {
                    results: contentBlock.content as Array<WebSearchResultBlock>,
                    source: WebSearchSource.ANTHROPIC
                  }
                } as LLMWebSearchCompleteChunk
              }
              break
            }
            case 'tool_use': {
              toolCalls[rawChunk.index] = contentBlock
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
                yield {
                  type: ChunkType.TEXT_DELTA,
                  text: messageDelta.text
                } as TextDeltaChunk
              }
              break
            }
            case 'thinking_delta': {
              if (messageDelta.thinking) {
                yield {
                  type: ChunkType.THINKING_DELTA,
                  text: messageDelta.thinking
                } as ThinkingDeltaChunk
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
              toolCall.input = JSON.parse(accumulatedJson)
              Logger.debug(`Tool call id: ${toolCall.id}, accumulated json: ${accumulatedJson}`)
              yield {
                type: ChunkType.MCP_TOOL_CREATED,
                tool_calls: [toolCall]
              } as MCPToolCreatedChunk
            } catch (error) {
              Logger.error(`Error parsing tool call input: ${error}`)
            }
          }
        }
      }
    }
  }
}
