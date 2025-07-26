import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { CompletionsContext } from '@renderer/aiCore/middleware/types'
import {
  isOpenAIChatCompletionOnlyModel,
  isOpenAILLMModel,
  isSupportedReasoningEffortOpenAIModel,
  isVisionModel
} from '@renderer/config/models'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  FileMetadata,
  FileTypes,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse,
  WebSearchSource
} from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  OpenAIResponseSdkMessageParam,
  OpenAIResponseSdkParams,
  OpenAIResponseSdkRawChunk,
  OpenAIResponseSdkRawOutput,
  OpenAIResponseSdkTool,
  OpenAIResponseSdkToolCall
} from '@renderer/types/sdk'
import { addImageFileToContents } from '@renderer/utils/formats'
import {
  isEnabledToolUse,
  mcpToolCallResponseToOpenAIMessage,
  mcpToolsToOpenAIResponseTools,
  openAIToolsToMcpTool
} from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { MB } from '@shared/config/constant'
import { isEmpty } from 'lodash'
import OpenAI, { AzureOpenAI } from 'openai'
import { ResponseInput } from 'openai/resources/responses/responses'

import { RequestTransformer, ResponseChunkTransformer } from '../types'
import { OpenAIAPIClient } from './OpenAIApiClient'
import { OpenAIBaseClient } from './OpenAIBaseClient'

export class OpenAIResponseAPIClient extends OpenAIBaseClient<
  OpenAI,
  OpenAIResponseSdkParams,
  OpenAIResponseSdkRawOutput,
  OpenAIResponseSdkRawChunk,
  OpenAIResponseSdkMessageParam,
  OpenAIResponseSdkToolCall,
  OpenAIResponseSdkTool
> {
  private client: OpenAIAPIClient
  constructor(provider: Provider) {
    super(provider)
    this.client = new OpenAIAPIClient(provider)
  }

  private formatApiHost() {
    const host = this.provider.apiHost
    if (host.endsWith('/openai/v1')) {
      return host
    } else {
      if (host.endsWith('/')) {
        return host + 'openai/v1'
      } else {
        return host + '/openai/v1'
      }
    }
  }

  /**
   * 根据模型特征选择合适的客户端
   */
  public getClient(model: Model) {
    if (this.provider.type === 'openai-response' && !isOpenAIChatCompletionOnlyModel(model)) {
      return this
    }
    if (isOpenAILLMModel(model) && !isOpenAIChatCompletionOnlyModel(model)) {
      if (this.provider.id === 'azure-openai' || this.provider.type === 'azure-openai') {
        this.provider = { ...this.provider, apiHost: this.formatApiHost() }
        if (this.provider.apiVersion === 'preview') {
          return this
        } else {
          return this.client
        }
      }
      return this
    } else {
      return this.client
    }
  }

  /**
   * 重写基类方法，返回内部实际使用的客户端类型
   */
  public override getClientCompatibilityType(model?: Model): string[] {
    if (!model) {
      return [this.constructor.name]
    }

    const actualClient = this.getClient(model)
    // 避免循环调用：如果返回的是自己，直接返回自己的类型
    if (actualClient === this) {
      return [this.constructor.name]
    }
    return actualClient.getClientCompatibilityType(model)
  }

  override async getSdkInstance() {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    if (this.provider.id === 'azure-openai' || this.provider.type === 'azure-openai') {
      return new AzureOpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.apiKey,
        apiVersion: this.provider.apiVersion,
        baseURL: this.provider.apiHost
      })
    } else {
      return new OpenAI({
        dangerouslyAllowBrowser: true,
        apiKey: this.apiKey,
        baseURL: this.getBaseURL(),
        defaultHeaders: {
          ...this.defaultHeaders(),
          ...this.provider.extra_headers
        }
      })
    }
  }

  override async createCompletions(
    payload: OpenAIResponseSdkParams,
    options?: OpenAI.RequestOptions
  ): Promise<OpenAIResponseSdkRawOutput> {
    const sdk = await this.getSdkInstance()
    return await sdk.responses.create(payload, options)
  }

  private async handlePdfFile(file: FileMetadata): Promise<OpenAI.Responses.ResponseInputFile | undefined> {
    if (file.size > 32 * MB) return undefined
    try {
      const pageCount = await window.api.file.pdfInfo(file.id + file.ext)
      if (pageCount > 100) return undefined
    } catch {
      return undefined
    }

    const { data } = await window.api.file.base64File(file.id + file.ext)
    return {
      type: 'input_file',
      filename: file.origin_name,
      file_data: `data:application/pdf;base64,${data}`
    } as OpenAI.Responses.ResponseInputFile
  }

  public async convertMessageToSdkParam(message: Message, model: Model): Promise<OpenAIResponseSdkMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    if (fileBlocks.length === 0 && imageBlocks.length === 0) {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: content
        }
      } else {
        return {
          role: message.role === 'system' ? 'user' : message.role,
          content: content ? [{ type: 'input_text', text: content }] : []
        } as OpenAI.Responses.EasyInputMessage
      }
    }

    const parts: OpenAI.Responses.ResponseInputContent[] = []
    if (content) {
      parts.push({
        type: 'input_text',
        text: content
      })
    }

    for (const imageBlock of imageBlocks) {
      if (isVision) {
        if (imageBlock.file) {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          parts.push({
            detail: 'auto',
            type: 'input_image',
            image_url: image.data as string
          })
        } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
          parts.push({
            detail: 'auto',
            type: 'input_image',
            image_url: imageBlock.url
          })
        }
      }
    }

    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (!file) continue

      if (isVision && file.ext === '.pdf') {
        const pdfPart = await this.handlePdfFile(file)
        if (pdfPart) {
          parts.push(pdfPart)
          continue
        }
      }

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = (await window.api.file.read(file.id + file.ext, true)).trim()
        parts.push({
          type: 'input_text',
          text: file.origin_name + '\n' + fileContent
        })
      }
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): OpenAI.Responses.Tool[] {
    return mcpToolsToOpenAIResponseTools(mcpTools)
  }

  public convertSdkToolCallToMcp(toolCall: OpenAIResponseSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return openAIToolsToMcpTool(mcpTools, toolCall)
  }
  public convertSdkToolCallToMcpToolResponse(toolCall: OpenAIResponseSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    const parsedArgs = (() => {
      try {
        return JSON.parse(toolCall.arguments)
      } catch {
        return toolCall.arguments
      }
    })()

    return {
      id: toolCall.call_id,
      toolCallId: toolCall.call_id,
      tool: mcpTool,
      arguments: parsedArgs,
      status: 'pending'
    }
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): OpenAIResponseSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      return mcpToolCallResponseToOpenAIMessage(mcpToolResponse, resp, isVisionModel(model))
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      return {
        type: 'function_call_output',
        call_id: mcpToolResponse.toolCallId,
        output: JSON.stringify(resp.content)
      }
    }
    return
  }

  private convertResponseToMessageContent(response: OpenAI.Responses.Response): ResponseInput {
    const content: OpenAI.Responses.ResponseInput = []
    content.push(...response.output)
    return content
  }

  public buildSdkMessages(
    currentReqMessages: OpenAIResponseSdkMessageParam[],
    output: OpenAI.Responses.Response | undefined,
    toolResults: OpenAIResponseSdkMessageParam[],
    toolCalls: OpenAIResponseSdkToolCall[]
  ): OpenAIResponseSdkMessageParam[] {
    if (!output && toolCalls.length === 0) {
      return [...currentReqMessages, ...toolResults]
    }

    if (!output) {
      return [...currentReqMessages, ...(toolCalls || []), ...(toolResults || [])]
    }

    const content = this.convertResponseToMessageContent(output)

    const newReqMessages = [...currentReqMessages, ...content, ...(toolResults || [])]
    return newReqMessages
  }

  override estimateMessageTokens(message: OpenAIResponseSdkMessageParam): number {
    let sum = 0
    if ('content' in message) {
      if (typeof message.content === 'string') {
        sum += estimateTextTokens(message.content)
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          switch (part.type) {
            case 'input_text':
              sum += estimateTextTokens(part.text)
              break
            case 'input_image':
              sum += estimateTextTokens(part.image_url || '')
              break
            default:
              break
          }
        }
      }
    }
    switch (message.type) {
      case 'function_call_output':
        sum += estimateTextTokens(message.output)
        break
      case 'function_call':
        sum += estimateTextTokens(message.arguments)
        break
      default:
        break
    }
    return sum
  }

  public extractMessagesFromSdkPayload(sdkPayload: OpenAIResponseSdkParams): OpenAIResponseSdkMessageParam[] {
    if (typeof sdkPayload.input === 'string') {
      return [{ role: 'user', content: sdkPayload.input }]
    }
    return sdkPayload.input
  }

  getRequestTransformer(): RequestTransformer<OpenAIResponseSdkParams, OpenAIResponseSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: OpenAIResponseSdkParams
        messages: OpenAIResponseSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput, enableWebSearch, enableGenerateImage } = coreRequest
        // 1. 处理系统消息
        const systemMessage: OpenAI.Responses.EasyInputMessage = {
          role: 'system',
          content: []
        }

        const systemMessageContent: OpenAI.Responses.ResponseInputMessageContentList = []
        const systemMessageInput: OpenAI.Responses.ResponseInputText = {
          text: assistant.prompt || '',
          type: 'input_text'
        }
        if (isSupportedReasoningEffortOpenAIModel(model)) {
          systemMessage.role = 'developer'
        }

        // 2. 设置工具
        let tools: OpenAI.Responses.Tool[] = []
        const { tools: extraTools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        systemMessageContent.push(systemMessageInput)
        systemMessage.content = systemMessageContent

        // 3. 处理用户消息
        let userMessage: OpenAI.Responses.ResponseInputItem[] = []
        if (typeof messages === 'string') {
          userMessage.push({ role: 'user', content: messages })
        } else {
          const processedMessages = addImageFileToContents(messages)
          for (const message of processedMessages) {
            userMessage.push(await this.convertMessageToSdkParam(message, model))
          }
        }
        // FIXME: 最好还是直接使用previous_response_id来处理（或者在数据库中存储image_generation_call的id）
        if (enableGenerateImage) {
          const finalAssistantMessage = userMessage.findLast(
            (m) => (m as OpenAI.Responses.EasyInputMessage).role === 'assistant'
          ) as OpenAI.Responses.EasyInputMessage
          const finalUserMessage = userMessage.pop() as OpenAI.Responses.EasyInputMessage
          if (finalUserMessage && Array.isArray(finalUserMessage.content)) {
            if (finalAssistantMessage && Array.isArray(finalAssistantMessage.content)) {
              finalAssistantMessage.content = [...finalAssistantMessage.content, ...finalUserMessage.content]
              // 这里是故意将上条助手消息的内容（包含图片和文件）作为用户消息发送
              userMessage = [{ ...finalAssistantMessage, role: 'user' } as OpenAI.Responses.EasyInputMessage]
            } else {
              userMessage.push(finalUserMessage)
            }
          }
        }

        // 4. 最终请求消息
        let reqMessages: OpenAI.Responses.ResponseInput
        if (!systemMessage.content) {
          reqMessages = [...userMessage]
        } else {
          reqMessages = [systemMessage, ...userMessage].filter(Boolean) as OpenAI.Responses.EasyInputMessage[]
        }

        if (enableWebSearch) {
          tools.push({
            type: 'web_search_preview'
          })
        }

        if (enableGenerateImage) {
          tools.push({
            type: 'image_generation',
            partial_images: streamOutput ? 2 : undefined
          })
        }

        tools = tools.concat(extraTools)
        const commonParams = {
          model: model.id,
          input:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : reqMessages,
          temperature: this.getTemperature(assistant, model),
          top_p: this.getTopP(assistant, model),
          max_output_tokens: maxTokens,
          stream: streamOutput,
          tools: !isEmpty(tools) ? tools : undefined,
          service_tier: this.getServiceTier(model),
          ...(this.getReasoningEffort(assistant, model) as OpenAI.Reasoning),
          // 只在对话场景下应用自定义参数，避免影响翻译、总结等其他业务逻辑
          ...(coreRequest.callType === 'chat' ? this.getCustomParameters(assistant) : {})
        }
        const sdkParams: OpenAIResponseSdkParams = streamOutput
          ? {
              ...commonParams,
              stream: true
            }
          : {
              ...commonParams,
              stream: false
            }
        const timeout = this.getTimeout(model)
        return { payload: sdkParams, messages: reqMessages, metadata: { timeout } }
      }
    }
  }

  getResponseChunkTransformer(ctx: CompletionsContext): ResponseChunkTransformer<OpenAIResponseSdkRawChunk> {
    const toolCalls: OpenAIResponseSdkToolCall[] = []
    const outputItems: OpenAI.Responses.ResponseOutputItem[] = []
    let hasBeenCollectedToolCalls = false
    let hasReasoningSummary = false
    let isFirstThinkingChunk = true
    let isFirstTextChunk = true
    return () => ({
      async transform(chunk: OpenAIResponseSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        // 处理chunk
        if ('output' in chunk) {
          if (ctx._internal?.toolProcessingState) {
            ctx._internal.toolProcessingState.output = chunk
          }
          for (const output of chunk.output) {
            switch (output.type) {
              case 'message':
                if (output.content[0].type === 'output_text') {
                  if (isFirstTextChunk) {
                    controller.enqueue({
                      type: ChunkType.TEXT_START
                    })
                    isFirstTextChunk = false
                  }
                  controller.enqueue({
                    type: ChunkType.TEXT_DELTA,
                    text: output.content[0].text
                  })
                  if (output.content[0].annotations && output.content[0].annotations.length > 0) {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                      llm_web_search: {
                        source: WebSearchSource.OPENAI_RESPONSE,
                        results: output.content[0].annotations
                      }
                    })
                  }
                }
                break
              case 'reasoning':
                if (isFirstThinkingChunk) {
                  controller.enqueue({
                    type: ChunkType.THINKING_START
                  })
                  isFirstThinkingChunk = false
                }
                controller.enqueue({
                  type: ChunkType.THINKING_DELTA,
                  text: output.summary.map((s) => s.text).join('\n')
                })
                break
              case 'function_call':
                toolCalls.push(output)
                break
              case 'image_generation_call':
                controller.enqueue({
                  type: ChunkType.IMAGE_CREATED
                })
                controller.enqueue({
                  type: ChunkType.IMAGE_COMPLETE,
                  image: {
                    type: 'base64',
                    images: [`data:image/png;base64,${output.result}`]
                  }
                })
            }
          }
          if (toolCalls.length > 0) {
            controller.enqueue({
              type: ChunkType.MCP_TOOL_CREATED,
              tool_calls: toolCalls
            })
          }
          controller.enqueue({
            type: ChunkType.LLM_RESPONSE_COMPLETE,
            response: {
              usage: {
                prompt_tokens: chunk.usage?.input_tokens || 0,
                completion_tokens: chunk.usage?.output_tokens || 0,
                total_tokens: chunk.usage?.total_tokens || 0
              }
            }
          })
        } else {
          switch (chunk.type) {
            case 'response.output_item.added':
              if (chunk.item.type === 'function_call') {
                outputItems.push(chunk.item)
              } else if (chunk.item.type === 'web_search_call') {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                })
              }
              break
            case 'response.reasoning_summary_part.added':
              if (hasReasoningSummary) {
                const separator = '\n\n'
                controller.enqueue({
                  type: ChunkType.THINKING_DELTA,
                  text: separator
                })
              }
              hasReasoningSummary = true
              break
            case 'response.reasoning_summary_text.delta':
              if (isFirstThinkingChunk) {
                controller.enqueue({
                  type: ChunkType.THINKING_START
                })
                isFirstThinkingChunk = false
              }
              controller.enqueue({
                type: ChunkType.THINKING_DELTA,
                text: chunk.delta
              })
              break
            case 'response.image_generation_call.generating':
              controller.enqueue({
                type: ChunkType.IMAGE_CREATED
              })
              break
            case 'response.image_generation_call.partial_image':
              controller.enqueue({
                type: ChunkType.IMAGE_DELTA,
                image: {
                  type: 'base64',
                  images: [`data:image/png;base64,${chunk.partial_image_b64}`]
                }
              })
              break
            case 'response.image_generation_call.completed':
              controller.enqueue({
                type: ChunkType.IMAGE_COMPLETE
              })
              break
            case 'response.output_text.delta': {
              if (isFirstTextChunk) {
                controller.enqueue({
                  type: ChunkType.TEXT_START
                })
                isFirstTextChunk = false
              }
              controller.enqueue({
                type: ChunkType.TEXT_DELTA,
                text: chunk.delta
              })
              break
            }
            case 'response.function_call_arguments.done': {
              const outputItem: OpenAI.Responses.ResponseOutputItem | undefined = outputItems.find(
                (item) => item.id === chunk.item_id
              )
              if (outputItem) {
                if (outputItem.type === 'function_call') {
                  toolCalls.push({
                    ...outputItem,
                    arguments: chunk.arguments,
                    status: 'completed'
                  })
                }
              }
              break
            }
            case 'response.content_part.done': {
              if (chunk.part.type === 'output_text' && chunk.part.annotations && chunk.part.annotations.length > 0) {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: {
                    source: WebSearchSource.OPENAI_RESPONSE,
                    results: chunk.part.annotations
                  }
                })
              }
              if (toolCalls.length > 0 && !hasBeenCollectedToolCalls) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: toolCalls
                })
                hasBeenCollectedToolCalls = true
              }
              break
            }
            case 'response.completed': {
              if (ctx._internal?.toolProcessingState) {
                ctx._internal.toolProcessingState.output = chunk.response
              }
              if (toolCalls.length > 0 && !hasBeenCollectedToolCalls) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: toolCalls
                })
                hasBeenCollectedToolCalls = true
              }
              const completion_tokens = chunk.response.usage?.output_tokens || 0
              const total_tokens = chunk.response.usage?.total_tokens || 0
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: chunk.response.usage?.input_tokens || 0,
                    completion_tokens: completion_tokens,
                    total_tokens: total_tokens
                  }
                }
              })
              break
            }
            case 'error': {
              controller.enqueue({
                type: ChunkType.ERROR,
                error: {
                  message: chunk.message,
                  code: chunk.code
                }
              })
              break
            }
          }
        }
      }
    })
  }
}
