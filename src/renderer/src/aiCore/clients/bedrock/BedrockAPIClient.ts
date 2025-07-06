import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseStreamCommand
} from '@aws-sdk/client-bedrock-runtime'
import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import { findTokenLimit, isReasoningModel, isVisionModel } from '@renderer/config/models'
import { getAssistantSettings } from '@renderer/services/AssistantService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import {
  Assistant,
  EFFORT_RATIO,
  FileTypes,
  GenerateImageParams,
  isBedrock,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse
} from '@renderer/types'
import { ChunkType, ThinkingDeltaChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import {
  BedrockOptions,
  BedrockSdkInstance,
  BedrockSdkMessageParam,
  BedrockSdkParams,
  BedrockSdkRawChunk,
  BedrockSdkRawOutput,
  BedrockSdkTool,
  BedrockSdkToolCall,
  SdkModel
} from '@renderer/types/sdk'
import { addImageFileToContents } from '@renderer/utils/formats'
import { isEnabledToolUse } from '@renderer/utils/mcp-tools'
import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { buildSystemPrompt } from '@renderer/utils/prompt'
import { Buffer } from 'buffer'

import { GenericChunk } from '../../middleware/schemas'
import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

// Type definitions for better type safety
interface BedrockUsage {
  inputTokens?: number
  outputTokens?: number
}

export class BedrockAPIClient extends BaseApiClient<
  BedrockSdkInstance,
  BedrockSdkParams,
  BedrockSdkRawOutput,
  BedrockSdkRawChunk,
  BedrockSdkMessageParam,
  BedrockSdkToolCall,
  BedrockSdkTool
> {
  private client?: BedrockRuntimeClient

  constructor(provider: Provider) {
    super(provider)
  }

  private getModelId(model: Model): string {
    if (!isBedrock(this.provider)) {
      return model.id
    }
    return this.provider.crossRegion ? `us.${model.id}` : model.id
  }

  async getSdkInstance(): Promise<BedrockSdkInstance> {
    if (!this.client) {
      if (!isBedrock(this.provider)) {
        throw new Error('Provider is not a Bedrock provider')
      }
      this.client = new BedrockRuntimeClient({
        region: this.provider.region || 'us-east-1',
        credentials: {
          accessKeyId: this.provider.accessKey || '',
          secretAccessKey: this.provider.secretKey || ''
        }
      })
    }
    return this.client as BedrockSdkInstance
  }

  override getTemperature(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isReasoningModel(model)) {
      return undefined
    }
    return assistant.settings?.temperature
  }

  override getTopP(assistant: Assistant, model: Model): number | undefined {
    if (assistant.settings?.reasoning_effort && isReasoningModel(model)) {
      return undefined
    }
    return assistant.settings?.topP
  }

  /**
   * Get the reasoning configuration for Bedrock extended thinking
   * @param assistant - The assistant
   * @param model - The model
   * @returns The reasoning configuration for additionalModelRequestFields
   */
  private getBudgetTokenConfig(assistant: Assistant, model: Model): Record<string, any> | undefined {
    if (!isReasoningModel(model)) {
      return undefined
    }

    const { maxTokens } = getAssistantSettings(assistant)
    const reasoningEffort = assistant?.settings?.reasoning_effort

    if (reasoningEffort === undefined) {
      return {
        thinking: {
          type: 'disabled'
        }
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
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens
      }
    }
  }

  override async createCompletions(payload: BedrockSdkParams, options?: BedrockOptions): Promise<BedrockSdkRawOutput> {
    const client = await this.getSdkInstance()
    if (payload.stream) {
      const command = new ConverseStreamCommand({
        modelId: payload.modelId,
        messages: payload.messages,
        system: payload.system,
        inferenceConfig: payload.inferenceConfig,
        toolConfig: payload.toolConfig,
        additionalModelRequestFields: payload.additionalModelRequestFields
      })
      const response = await client.send(command)
      return response.stream as BedrockSdkRawOutput
    } else {
      const command = new ConverseCommand({
        modelId: payload.modelId,
        messages: payload.messages,
        system: payload.system,
        inferenceConfig: payload.inferenceConfig,
        toolConfig: payload.toolConfig,
        additionalModelRequestFields: payload.additionalModelRequestFields
      })
      const response = await client.send(command)
      return response as BedrockSdkRawOutput
    }
  }

  override async generateImage(params: GenerateImageParams): Promise<string[]> {
    throw new Error('Image generation not supported by Bedrock client')
  }

  override async getEmbeddingDimensions(model?: Model): Promise<number> {
    throw new Error("Bedrock SDK doesn't support getEmbeddingDimensions method.")
  }

  override async generateImage(): Promise<string[]> {
    throw new Error('Image generation not supported by Bedrock client')
  }

  override async getEmbeddingDimensions(): Promise<number> {
    throw new Error("Bedrock SDK doesn't support getEmbeddingDimensions method.")
  }

  override async listModels(): Promise<SdkModel[]> {
    return []
  }

  public async convertMessageToSdkParam(message: Message, model: Model): Promise<BedrockSdkMessageParam> {
    const isVision = isVisionModel(model)
    const content = await this.getMessageContent(message)
    const fileBlocks = findFileBlocks(message)
    const imageBlocks = findImageBlocks(message)

    const contentBlocks: ContentBlock[] = []

    if (content) {
      contentBlocks.push({ text: content })
    }

    // Handle images
    for (const imageBlock of imageBlocks) {
      if (isVision && imageBlock.file) {
        const image = await window.api.file.base64Image(imageBlock.file.id + imageBlock.file.ext)
        const base64Data = image.data.split(',')[1]
        const format = image.data.includes('jpeg') ? 'jpeg' : 'png'
        contentBlocks.push({
          image: {
            format: format as 'jpeg' | 'png' | 'gif' | 'webp',
            source: { bytes: new Uint8Array(Buffer.from(base64Data, 'base64')) }
          }
        })
      }
    }

    // Handle text files
    for (const fileBlock of fileBlocks) {
      const file = fileBlock.file
      if (file && [FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await window.api.file.read(file.id + file.ext)
        contentBlocks.push({ text: `${file.origin_name}\n${fileContent.trim()}` })
      }
    }

    return {
      role: message.role === 'system' ? 'user' : message.role,
      content: contentBlocks
    } as BedrockSdkMessageParam
  }

  convertMcpToolsToSdkTools(mcpTools: MCPTool[]): BedrockSdkTool[] {
    return mcpTools.map(
      (tool) =>
        ({
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: {
              json: tool.inputSchema
            }
          }
        }) as unknown as BedrockSdkTool
    )
  }

  convertSdkToolCallToMcp(toolCall: BedrockSdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return mcpTools.find((tool) => tool.name === toolCall.name)
  }

  convertSdkToolCallToMcpToolResponse(toolCall: BedrockSdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    return {
      id: toolCall.toolUseId,
      toolCallId: toolCall.toolUseId,
      tool: mcpTool,
      arguments: toolCall.input,
      status: 'pending'
    } as ToolCallResponse
  }

  convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse
  ): BedrockSdkMessageParam | undefined {
    if ('toolUseId' in mcpToolResponse && mcpToolResponse.toolUseId) {
      let resultText: string

      if (Array.isArray(resp.content) && resp.content.length > 0 && resp.content[0].text) {
        resultText = resp.content.map((c) => c.text || '').join('\n')
      } else if (typeof resp.content === 'object') {
        resultText = JSON.stringify(resp.content)
      } else {
        resultText = String(resp.content)
      }
      return {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: mcpToolResponse.toolUseId,
              content: [{ text: resultText }]
            }
          }
        ]
      } as BedrockSdkMessageParam
    }
    return undefined
  }

  override buildSdkMessages(
    currentReqMessages: BedrockSdkMessageParam[],
    output: BedrockSdkRawOutput | string | undefined,
    toolResults: BedrockSdkMessageParam[],
    toolCalls?: BedrockSdkToolCall[]
  ): BedrockSdkMessageParam[] {
    console.log('🔧 [BedrockAPIClient] buildSdkMessages CALLED!')
    console.log('🔧 currentReqMessages --->', currentReqMessages)
    console.log('🔧 output --->', output)
    console.log('🔧 toolResults --->', toolResults)
    console.log('🔧 toolCalls --->', toolCalls)

    const assistantMessage: BedrockSdkMessageParam = {
      role: 'assistant',
      content: []
    }

    const hasTextOutput = typeof output === 'string' && output.trim().length > 0
    const hasToolCalls = toolCalls && toolCalls.length > 0

    if (hasTextOutput) {
      assistantMessage.content!.push({ text: output as string })
    }

    if (hasToolCalls) {
      for (const tool of toolCalls!) {
        assistantMessage.content!.push({
          toolUse: {
            toolUseId: tool.toolUseId,
            name: tool.name,
            input: tool.input
          }
        })
      }
    }

    // Only add the assistant message if it has content
    if (hasTextOutput || hasToolCalls) {
      return [...currentReqMessages, assistantMessage, ...toolResults]
    }

    console.log('currentReqMessages', currentReqMessages)
    console.log('toolResults', toolResults)
    // Otherwise, just return the current messages plus any tool results (though this case is rare)
    return [...currentReqMessages, ...toolResults]
  }

  override estimateMessageTokens(message: BedrockSdkMessageParam): number {
    let sum = 0
    if (message.content) {
      for (const block of message.content) {
        if ('text' in block && block.text) {
          sum += estimateTextTokens(block.text)
        }
      }
    }
    return sum
  }

  extractMessagesFromSdkPayload(sdkPayload: BedrockSdkParams): BedrockSdkMessageParam[] {
    return sdkPayload.messages || []
  }

  getRequestTransformer(): RequestTransformer<BedrockSdkParams, BedrockSdkMessageParam> {
    return {
      transform: async (
        coreRequest,
        assistant,
        model,
        isRecursiveCall,
        recursiveSdkMessages
      ): Promise<{
        payload: BedrockSdkParams
        messages: BedrockSdkMessageParam[]
        metadata: Record<string, any>
      }> => {
        const { messages, mcpTools, maxTokens, streamOutput } = coreRequest

        // Setup tools
        const { tools } = this.setupToolsConfig({
          mcpTools: mcpTools,
          model,
          enableToolUse: isEnabledToolUse(assistant)
        })

        // Build system message
        let systemContent = assistant.prompt || ''
        if (this.useSystemPromptForTools) {
          systemContent = await buildSystemPrompt(systemContent, mcpTools, assistant)
        }

        // Process user messages
        const userMessages: BedrockSdkMessageParam[] = []
        if (typeof messages === 'string') {
          userMessages.push({
            role: 'user',
            content: [{ text: messages }]
          })
        } else {
          const processedMessages = addImageFileToContents(messages)
          for (const message of processedMessages) {
            userMessages.push(await this.convertMessageToSdkParam(message, model))
          }
        }

        const reqMessages =
          isRecursiveCall && recursiveSdkMessages && recursiveSdkMessages.length > 0
            ? recursiveSdkMessages
            : userMessages

        // Build inference config
        const inferenceConfig: any = {
          maxTokens: maxTokens || DEFAULT_MAX_TOKENS,
          temperature: this.getTemperature(assistant, model),
          topP: this.getTopP(assistant, model)
        }

        // Get reasoning configuration
        const reasoningConfig = this.getBudgetTokenConfig(assistant, model)

        const sdkParams: BedrockSdkParams = {
          modelId: this.getModelId(model),
          messages: reqMessages,
          system: systemContent ? [{ text: systemContent }] : undefined,
          inferenceConfig,
          toolConfig: tools.length > 0 ? { tools } : undefined,
          additionalModelRequestFields: reasoningConfig,
          stream: streamOutput
        }
        const timeout = this.getTimeout(model)
        return { payload: sdkParams, messages: reqMessages, metadata: { timeout } }
      }
    }
  }

  // Helper methods for cleaner response processing
  private extractUsage(usage?: BedrockUsage) {
    if (!usage) return null
    return {
      prompt_tokens: usage.inputTokens || 0,
      completion_tokens: usage.outputTokens || 0,
      total_tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0)
    }
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<BedrockSdkRawChunk> {
    return () => {
      const toolCalls: BedrockSdkToolCall[] = []
      let usage: any = null

      return {
        transform: (chunk: BedrockSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) => {
          console.log('Raw_chunk', chunk)
          if (!chunk) {
            console.warn('Received empty chunk from Bedrock API')
            return
          }

          // Type guard to explicitly handle non-streaming (ConverseResponse)
          if ('output' in chunk) {
            const response = chunk
            if (response.usage) {
              usage = this.extractUsage(response.usage)
            }
            response.output?.message?.content?.forEach((item) => {
              if (item.text) {
                controller.enqueue({ type: ChunkType.TEXT_DELTA, text: item.text })
              }
              if (item.toolUse) {
                toolCalls.push({
                  toolUseId: item.toolUse.toolUseId || '',
                  name: item.toolUse.name || '',
                  input: item.toolUse.input || {},
                  type: 'tool_use'
                })
              }
            })

            // 处理完所有内容后，根据 stopReason 决定发送什么
            if (response.stopReason === 'tool_use' && toolCalls.length > 0) {
              const completedToolCalls = toolCalls.map((tc) => {
                try {
                  const parsedInput = typeof tc.input === 'string' && tc.input ? JSON.parse(tc.input) : tc.input
                  return { ...tc, input: parsedInput || {} }
                } catch (e) {
                  console.error('Error parsing tool call input JSON:', tc.input, e)
                  return { ...tc, input: {} }
                }
              })
              controller.enqueue({ type: ChunkType.MCP_TOOL_CREATED, tool_calls: completedToolCalls })
            }
            controller.enqueue({
              type: ChunkType.LLM_RESPONSE_COMPLETE,
              response: { usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
            })
          } else {
            // Handle streaming chunks by checking for the presence of specific keys
            const streamChunk = chunk as any

            if (streamChunk.contentBlockStart?.start?.toolUse) {
              const { toolUseId, name } = streamChunk.contentBlockStart.start.toolUse
              toolCalls.push({ toolUseId: toolUseId || '', name: name || '', input: '', type: 'tool_use' })
            }

            if (streamChunk.contentBlockDelta?.delta) {
              const delta = streamChunk.contentBlockDelta.delta
              if (delta.text) {
                controller.enqueue({ type: ChunkType.TEXT_DELTA, text: delta.text })
              }
              if (delta.toolUse?.input && toolCalls.length > 0) {
                toolCalls[toolCalls.length - 1].input += delta.toolUse.input
              }
              // Handle extended thinking (reasoning) content
              if (delta.reasoningContent?.text) {
                controller.enqueue({
                  type: ChunkType.THINKING_DELTA,
                  text: delta.reasoningContent.text
                } as ThinkingDeltaChunk)
              }
            }

            if (streamChunk.metadata?.usage) {
              usage = this.extractUsage(streamChunk.metadata.usage)
            }

            if (streamChunk.messageStop?.stopReason) {
              console.log('toolCalls --->', toolCalls)
              console.log('stopReason --->', streamChunk.messageStop.stopReason)

              if (streamChunk.messageStop.stopReason === 'tool_use' && toolCalls.length > 0) {
                const completedToolCalls = toolCalls.map((tc) => {
                  try {
                    const parsedInput = typeof tc.input === 'string' && tc.input ? JSON.parse(tc.input) : tc.input
                    return { ...tc, input: parsedInput || {} }
                  } catch (e) {
                    console.error('Error parsing tool call input JSON:', tc.input, e)
                    return { ...tc, input: {} }
                  }
                })
                controller.enqueue({ type: ChunkType.MCP_TOOL_CREATED, tool_calls: completedToolCalls })
              }
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: { usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
              })
            }
          }
        }
      }
    }
  }
}
