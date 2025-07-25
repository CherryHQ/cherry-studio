import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { loggerService } from '@logger'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse
} from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk, TextDeltaChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  AwsBedrockSdkInstance,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkTool,
  AwsBedrockSdkToolCall,
  SdkModel
} from '@renderer/types/sdk'
import {
  awsBedrockToolUseToMcpTool,
  isEnabledToolUse,
  mcpToolCallResponseToAwsBedrockMessage,
  mcpToolsToAwsBedrockTools
} from '@renderer/utils/mcp-tools'
import { findImageBlocks } from '@renderer/utils/messageUtils/find'

import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

const logger = loggerService.withContext('AwsBedrockAPIClient')

export class AwsBedrockAPIClient extends BaseApiClient<
  AwsBedrockSdkInstance,
  AwsBedrockSdkParams,
  AwsBedrockSdkRawOutput,
  AwsBedrockSdkRawChunk,
  AwsBedrockSdkMessageParam,
  AwsBedrockSdkToolCall,
  AwsBedrockSdkTool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  async getSdkInstance(): Promise<AwsBedrockSdkInstance> {
    if (this.sdkInstance) {
      return this.sdkInstance
    }

    const region = getAwsBedrockRegion()
    const accessKeyId = getAwsBedrockAccessKeyId()
    const secretAccessKey = getAwsBedrockSecretAccessKey()

    if (!region) {
      throw new Error('AWS region is required. Please configure AWS-Region in extra headers.')
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials are required. Please configure AWS-Access-Key-ID and AWS-Secret-Access-Key.')
    }

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    })

    this.sdkInstance = { client, region }
    return this.sdkInstance
  }

  override async createCompletions(payload: AwsBedrockSdkParams): Promise<AwsBedrockSdkRawOutput> {
    const sdk = await this.getSdkInstance()

    // 转换消息格式到AWS SDK原生格式
    const awsMessages = payload.messages.map((msg) => ({
      role: msg.role,
      content: msg.content.map((content) => {
        if (content.text) {
          return { text: content.text }
        }
        if (content.image) {
          return {
            image: {
              format: content.image.format,
              source: content.image.source
            }
          }
        }
        if (content.toolResult) {
          return {
            toolResult: {
              toolUseId: content.toolResult.toolUseId,
              content: content.toolResult.content,
              status: content.toolResult.status
            }
          }
        }
        if (content.toolUse) {
          return {
            toolUse: {
              toolUseId: content.toolUse.toolUseId,
              name: content.toolUse.name,
              input: content.toolUse.input
            }
          }
        }
        // 返回符合AWS SDK ContentBlock类型的对象
        return { text: 'Unknown content type' }
      })
    }))

    const commonParams = {
      modelId: payload.modelId,
      messages: awsMessages as any,
      system: payload.system ? [{ text: payload.system }] : undefined,
      inferenceConfig: {
        maxTokens: payload.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: payload.temperature || 0.7,
        topP: payload.topP || 1
      },
      toolConfig:
        payload.tools && payload.tools.length > 0
          ? {
              tools: payload.tools
            }
          : undefined
    }

    try {
      if (payload.stream) {
        const command = new ConverseStreamCommand(commonParams)
        const response = await sdk.client.send(command)
        // 直接返回AWS Bedrock流式响应的异步迭代器
        return this.createStreamIterator(response)
      } else {
        const command = new ConverseCommand(commonParams)
        const response = await sdk.client.send(command)
        return { output: response }
      }
    } catch (error) {
      logger.error('Failed to create completions with AWS Bedrock:', error as Error)
      throw error
    }
  }

  private async *createStreamIterator(response: any): AsyncIterable<AwsBedrockSdkRawChunk> {
    try {
      if (response.stream) {
        for await (const chunk of response.stream) {
          logger.debug('AWS Bedrock chunk received:', chunk)

          // AWS Bedrock的流式响应格式转换为标准格式
          if (chunk.contentBlockDelta?.delta?.text) {
            yield {
              contentBlockDelta: {
                delta: { text: chunk.contentBlockDelta.delta.text }
              }
            }
          }

          if (chunk.messageStart) {
            yield { messageStart: chunk.messageStart }
          }

          if (chunk.messageStop) {
            yield { messageStop: chunk.messageStop }
          }

          if (chunk.metadata) {
            yield { metadata: chunk.metadata }
          }
        }
      }
    } catch (error) {
      logger.error('Error in AWS Bedrock stream iterator:', error as Error)
      throw error
    }
  }

  // @ts-ignore sdk未提供
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async generateImage(_generateImageParams: GenerateImageParams): Promise<string[]> {
    return []
  }

  override async getEmbeddingDimensions(model?: Model): Promise<number> {
    if (!model) return 1536

    const modelId = model.id.toLowerCase()
    if (modelId.includes('titan-embed')) {
      return 1536
    }
    if (modelId.includes('cohere.embed')) {
      return 1024
    }

    return 1536
  }

  // @ts-ignore sdk未提供
  override async listModels(): Promise<SdkModel[]> {
    return []
  }

  public async convertMessageToSdkParam(message: Message): Promise<AwsBedrockSdkMessageParam> {
    const content = await this.getMessageContent(message)
    const parts: Array<{
      text?: string
      image?: {
        format: 'png' | 'jpeg' | 'gif' | 'webp'
        source: {
          bytes?: Uint8Array
          s3Location?: {
            uri: string
            bucketOwner?: string
          }
        }
      }
    }> = []

    // 添加文本内容 - 只在有非空内容时添加
    if (content && content.trim()) {
      parts.push({ text: content })
    }

    // 处理图片内容
    const imageBlocks = findImageBlocks(message)
    for (const imageBlock of imageBlocks) {
      if (imageBlock.file) {
        try {
          const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
          // 从MIME类型中提取格式
          const mimeType = image.mime || 'image/png'
          const format = mimeType.split('/')[1] as 'png' | 'jpeg' | 'gif' | 'webp'

          if (['png', 'jpeg', 'gif', 'webp'].includes(format)) {
            // 在浏览器环境中正确处理base64转换为Uint8Array
            const base64Data = image.base64
            const binaryString = atob(base64Data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }

            parts.push({
              image: {
                format: format,
                source: {
                  bytes: bytes
                }
              }
            })
          } else {
            // 不支持的格式，转换为文本描述
            parts.push({ text: `[Image: ${mimeType}]` })
          }
        } catch (error) {
          logger.error('Error processing image:', error as Error)
          parts.push({ text: '[Image processing failed]' })
        }
      } else if (imageBlock.url && imageBlock.url.startsWith('data:')) {
        try {
          // 处理base64图片URL
          const matches = imageBlock.url.match(/^data:(.+);base64,(.*)$/)
          if (matches && matches.length === 3) {
            const mimeType = matches[1]
            const base64Data = matches[2]
            const format = mimeType.split('/')[1] as 'png' | 'jpeg' | 'gif' | 'webp'

            if (['png', 'jpeg', 'gif', 'webp'].includes(format)) {
              // 在浏览器环境中正确处理base64转换为Uint8Array
              const binaryString = atob(base64Data)
              const bytes = new Uint8Array(binaryString.length)
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
              }

              parts.push({
                image: {
                  format: format,
                  source: {
                    bytes: bytes
                  }
                }
              })
            } else {
              parts.push({ text: `[Image: ${mimeType}]` })
            }
          }
        } catch (error) {
          logger.error('Error processing base64 image:', error as Error)
          parts.push({ text: '[Image processing failed]' })
        }
      }
    }

    // 如果没有任何内容，添加默认文本而不是空文本
    if (parts.length === 0) {
      parts.push({ text: 'No content provided' })
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: parts
    }
  }

  getRequestTransformer(): RequestTransformer<AwsBedrockSdkParams, AwsBedrockSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: AwsBedrockSdkParams
        messages: AwsBedrockSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput } = coreRequest
        // 1. 处理系统消息
        const systemPrompt = assistant.prompt
        // 2. 设置工具
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        // 3. 处理消息
        const sdkMessages: AwsBedrockSdkMessageParam[] = []
        if (typeof messages === 'string') {
          sdkMessages.push({ role: 'user', content: [{ text: messages }] })
        } else {
          for (const message of messages) {
            sdkMessages.push(await this.convertMessageToSdkParam(message))
          }
        }

        const payload: AwsBedrockSdkParams = {
          modelId: model.id,
          messages:
            isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
              ? recursiveSdkMessages
              : sdkMessages,
          system: systemPrompt,
          maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
          temperature: this.getTemperature(assistant, model),
          topP: this.getTopP(assistant, model),
          stream: streamOutput !== false,
          tools: tools.length > 0 ? tools : undefined
        }

        const timeout = this.getTimeout(model)
        return { payload, messages: sdkMessages, metadata: { timeout } }
      }
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<AwsBedrockSdkRawChunk> {
    return () => {
      let hasStartedText = false
      let accumulatedJson = ''
      const toolCalls: Record<number, AwsBedrockSdkToolCall> = {}

      return {
        async transform(rawChunk: AwsBedrockSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
          logger.debug('Processing AWS Bedrock chunk:', rawChunk)

          // 处理消息开始事件
          if (rawChunk.messageStart) {
            controller.enqueue({
              type: ChunkType.TEXT_START
            })
            hasStartedText = true
            logger.debug('Message started')
          }

          // 处理内容块开始事件 - 参考 Anthropic 的 content_block_start 处理
          if (rawChunk.contentBlockStart?.start?.toolUse) {
            const toolUse = rawChunk.contentBlockStart.start.toolUse
            const blockIndex = rawChunk.contentBlockStart.contentBlockIndex || 0
            toolCalls[blockIndex] = {
              id: toolUse.toolUseId, // 设置 id 字段与 toolUseId 相同
              name: toolUse.name,
              toolUseId: toolUse.toolUseId,
              input: {}
            }
            logger.debug('Tool use started:', toolUse)
          }

          // 处理内容块增量事件 - 参考 Anthropic 的 content_block_delta 处理
          if (rawChunk.contentBlockDelta?.delta?.toolUse?.input) {
            const inputDelta = rawChunk.contentBlockDelta.delta.toolUse.input
            accumulatedJson += inputDelta
          }

          // 处理文本增量
          if (rawChunk.contentBlockDelta?.delta?.text) {
            if (!hasStartedText) {
              controller.enqueue({
                type: ChunkType.TEXT_START
              })
              hasStartedText = true
            }

            controller.enqueue({
              type: ChunkType.TEXT_DELTA,
              text: rawChunk.contentBlockDelta.delta.text
            } as TextDeltaChunk)
          }

          // 处理内容块停止事件 - 参考 Anthropic 的 content_block_stop 处理
          if (rawChunk.contentBlockStop) {
            const blockIndex = rawChunk.contentBlockStop.contentBlockIndex || 0
            const toolCall = toolCalls[blockIndex]
            if (toolCall && accumulatedJson) {
              try {
                toolCall.input = JSON.parse(accumulatedJson)
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: [toolCall]
                } as MCPToolCreatedChunk)
                accumulatedJson = ''
              } catch (error) {
                logger.error('Error parsing tool call input:', error as Error)
              }
            }
          }

          // 处理消息结束事件
          if (rawChunk.messageStop) {
            // 从metadata中提取usage信息
            const usage = rawChunk.metadata?.usage || {}

            controller.enqueue({
              type: ChunkType.LLM_RESPONSE_COMPLETE,
              response: {
                usage: {
                  prompt_tokens: usage.inputTokens || 0,
                  completion_tokens: usage.outputTokens || 0,
                  total_tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
                }
              }
            })
          }
        }
      }
    }
  }

  public convertMcpToolsToSdkTools(mcpTools: MCPTool[]): AwsBedrockSdkTool[] {
    return mcpToolsToAwsBedrockTools(mcpTools)
  }

  convertSdkToolCallToMcp(toolCall: AwsBedrockSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return awsBedrockToolUseToMcpTool(mcpTools, toolCall)
  }

  convertSdkToolCallToMcpToolResponse(toolCall: AwsBedrockSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    return {
      id: toolCall.id,
      tool: mcpTool,
      arguments: toolCall.input || {},
      status: 'pending',
      toolCallId: toolCall.id
    }
  }

  override buildSdkMessages(
    currentReqMessages: AwsBedrockSdkMessageParam[],
    output: AwsBedrockSdkRawOutput | string | undefined,
    toolResults: AwsBedrockSdkMessageParam[]
  ): AwsBedrockSdkMessageParam[] {
    const messages: AwsBedrockSdkMessageParam[] = [...currentReqMessages]

    if (typeof output === 'string') {
      messages.push({
        role: 'assistant',
        content: [{ text: output }]
      })
    }

    if (toolResults.length > 0) {
      messages.push(...toolResults)
    }

    return messages
  }

  override estimateMessageTokens(message: AwsBedrockSdkMessageParam): number {
    if (typeof message.content === 'string') {
      return estimateTextTokens(message.content)
    }
    const content = message.content
    if (Array.isArray(content)) {
      return content.reduce((total, item) => {
        if (item.text) {
          return total + estimateTextTokens(item.text)
        }
        return total
      }, 0)
    }
    return 0
  }

  public convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): AwsBedrockSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      // 使用专用的转换函数处理 toolUseId 情况
      return mcpToolCallResponseToAwsBedrockMessage(mcpToolResponse, resp, model)
    } else if ('toolCallId' in mcpToolResponse && mcpToolResponse.toolCallId) {
      return {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: mcpToolResponse.toolCallId,
              content: resp.content
                .map((item) => {
                  if (item.type === 'text') {
                    // 确保文本不为空，如果为空则提供默认文本
                    return { text: item.text && item.text.trim() ? item.text : 'No text content' }
                  }
                  if (item.type === 'image' && item.data) {
                    const format = (item.mimeType?.split('/')[1] as 'png' | 'jpeg' | 'gif' | 'webp') || 'png'
                    // 在浏览器环境中正确处理base64转换为Uint8Array
                    const binaryString = atob(item.data)
                    const bytes = new Uint8Array(binaryString.length)
                    for (let i = 0; i < binaryString.length; i++) {
                      bytes[i] = binaryString.charCodeAt(i)
                    }
                    return {
                      image: {
                        format: format,
                        source: {
                          bytes: bytes
                        }
                      }
                    }
                  }
                  return { text: JSON.stringify(item) }
                })
                .filter((content) => content !== null)
            }
          }
        ]
      }
    }
    return undefined
  }

  extractMessagesFromSdkPayload(sdkPayload: AwsBedrockSdkParams): AwsBedrockSdkMessageParam[] {
    return sdkPayload.messages || []
  }
}
