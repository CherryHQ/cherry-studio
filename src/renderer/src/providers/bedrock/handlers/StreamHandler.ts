import { MCPTool, MCPToolResponse } from '@renderer/types'

import { BedrockClient } from '../client/BedrockClient'
import { InferenceConfig, SystemConfig, ThinkingConfig } from '../client/types'
import { createToolConfig, filterMessagesForToolUse } from '../utils/ToolUtils'
import { ToolChainHandler } from './ToolChainHandler'
import { ToolHandler } from './ToolHandler'

/**
 * Stream Response Handler
 * Handles streaming response processing
 */
export class StreamHandler {
  private static currentModelId: string = ''
  private static isThinkingCompleted: boolean = false

  /**
   * Handle stream response
   * @param client Bedrock client
   * @param modelId Model ID
   * @param bedrockMessages Bedrock messages
   * @param systemConfig System configuration
   * @param inferenceConfig Inference configuration
   * @param thinkingConfig Thinking configuration
   * @param signal Abort signal
   * @param onChunk Chunk callback
   * @param mcpTools MCP tools
   */
  public static async handle(
    client: BedrockClient,
    modelId: string,
    bedrockMessages: any[],
    systemConfig: SystemConfig,
    inferenceConfig: InferenceConfig,
    thinkingConfig: ThinkingConfig | undefined,
    signal: AbortSignal,
    onChunk: (chunk: any) => void,
    mcpTools?: MCPTool[]
  ): Promise<void> {
    // Reset thinking completion state for new conversation
    this.isThinkingCompleted = false

    // Save current model ID for use in messageStop event
    this.currentModelId = modelId

    // Create thinking state object
    const thinkingState = {
      currentThinkingBlock: false,
      currentTextBlock: false,
      startTime: 0,
      endTime: 0,
      reasoningContent: '',
      textContent: '',
      metrics: {}
    }

    // Create tool responses array
    const toolResponses: MCPToolResponse[] = []

    // Clone inference config to avoid modifying the original
    const updatedInferenceConfig = { ...inferenceConfig }

    // Add tool configuration if tools are available
    if (mcpTools && mcpTools.length > 0) {
      const toolConfig = createToolConfig(mcpTools)
      if (toolConfig) {
        updatedInferenceConfig.toolConfig = toolConfig
      }
    }

    // Get stream response
    const stream = await client.converseStream(modelId, bedrockMessages, systemConfig, updatedInferenceConfig, signal)

    // Process stream response
    for await (const chunk of stream.stream || []) {
      // Process different types of chunks
      if (this.handleContentBlockStart(chunk, thinkingState)) continue
      if (this.handleContentBlockStop(chunk, thinkingState)) continue
      if (this.handleReasoningContent(chunk, thinkingState, onChunk)) continue
      if (this.handleTextContent(chunk, thinkingConfig, thinkingState, onChunk)) continue
      if (this.handleUsageInfo(chunk, thinkingState, onChunk)) continue
      if (this.handleMetadata(chunk, onChunk)) continue

      // Process message stop event
      const messageStopHandled = await this.handleMessageStop(
        chunk,
        mcpTools,
        toolResponses,
        bedrockMessages,
        client,
        onChunk
      )
      if (messageStopHandled) continue

      // Process tool use
      const isToolHandled = await this.handleToolUse(chunk, mcpTools, toolResponses, bedrockMessages, client, onChunk)
      if (isToolHandled) continue
    }
  }

  /**
   * Handle content block start
   */
  private static handleContentBlockStart(chunk: any, thinkingState: any): boolean {
    if ((chunk as any).contentBlockStart?.contentBlock?.type === 'thinking') {
      thinkingState.currentThinkingBlock = true
      thinkingState.currentTextBlock = false

      // Record thinking start time
      if (thinkingState.startTime === 0) {
        thinkingState.startTime = Date.now()
      }
      return true
    }
    return false
  }

  /**
   * Handle content block stop
   */
  private static handleContentBlockStop(chunk: any, thinkingState: any): boolean {
    if ('contentBlockStop' in chunk) {
      const stoppedBlockIndex = (chunk as any).contentBlockStop?.contentBlockIndex

      // If it's text content block end
      if (stoppedBlockIndex === 1 && thinkingState.currentTextBlock) {
        thinkingState.currentTextBlock = false
      }

      return true
    }
    return false
  }

  /**
   * Handle reasoning content
   */
  private static handleReasoningContent(chunk: any, thinkingState: any, onChunk: (chunk: any) => void): boolean {
    if ((chunk as any).contentBlockDelta?.delta?.reasoningContent) {
      const reasoningContent = (chunk as any).contentBlockDelta.delta.reasoningContent

      // Process reasoningContent object
      if (reasoningContent.text) {
        // If this is the first time receiving thinking content, record start time
        if (thinkingState.startTime === 0) {
          thinkingState.startTime = Date.now()
        }

        // Send current chunk of thinking content to UI
        onChunk({
          reasoning_content: reasoningContent.text,
          text: ''
        })

        thinkingState.currentThinkingBlock = true
        return true
      }
    }
    return false
  }

  /**
   * Handle text content
   */
  private static handleTextContent(
    chunk: any,
    thinkingConfig: ThinkingConfig | undefined,
    thinkingState: any,
    onChunk: (chunk: any) => void
  ): boolean {
    if ((chunk as any).contentBlockDelta?.delta?.text) {
      const text = (chunk as any).contentBlockDelta.delta.text
      const contentBlockIndex = (chunk as any).contentBlockDelta?.contentBlockIndex

      // Check if this is the first text content and thinking has been happening
      if (!this.isThinkingCompleted && thinkingState && thinkingState.startTime > 0) {
        this.isThinkingCompleted = true

        thinkingState.endTime = Date.now()
        thinkingState.timeMs = thinkingState.endTime - thinkingState.startTime
        thinkingState.metrics = thinkingState.metrics ? thinkingState.metrics : {}
        thinkingState.metrics.time_thinking_millsec = thinkingState.timeMs
      }

      // Process text based on contentBlockIndex
      if (contentBlockIndex === 0 && thinkingConfig) {
        // This is thinking content block
        // If this is the first time receiving thinking content, record start time
        if (thinkingState.startTime === 0) {
          thinkingState.startTime = Date.now()
        }

        // Send current chunk of thinking content
        onChunk({
          reasoning_content: text,
          text: ''
        })

        thinkingState.currentThinkingBlock = true
        return true
      } else if (contentBlockIndex === 1 || (contentBlockIndex === 0 && !thinkingConfig)) {
        // Normal text processing - always send text content
        onChunk({
          text: text
        })

        thinkingState.currentTextBlock = true
        return true
      } else {
        // Unknown block index, try normal processing
        onChunk({
          text: text
        })
        return true
      }
    }
    return false
  }

  /**
   * Handle usage info
   */
  private static handleUsageInfo(chunk: any, thinkingState: any, onChunk: (chunk: any) => void): boolean {
    if ('usage' in chunk) {
      const usage = (chunk as any).usage
      if (usage) {
        // Ensure using correct field names
        const promptTokens = usage.inputTokens || 0
        const completionTokens = usage.outputTokens || 0
        const totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0)

        // If thinking has happened but end time not recorded, record it here
        if (thinkingState.startTime > 0 && thinkingState.endTime === 0) {
          thinkingState.endTime = Date.now()
          thinkingState.timeMs = thinkingState.endTime - thinkingState.startTime
          thinkingState.metrics.time_thinking_millsec = thinkingState.timeMs
        }

        // Send complete usage info
        onChunk({
          text: '',
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens
          },
          metrics: {
            completion_tokens: completionTokens,
            time_thinking_millsec:
              thinkingState.metrics.time_thinking_millsec > 0 ? thinkingState.metrics.time_thinking_millsec : undefined
          }
        })

        return true
      }
    }

    // Check if metadata contains usage info
    if ('metadata' in chunk) {
      const metadata = (chunk as any).metadata
      if (metadata && metadata.usage) {
        const usage = metadata.usage
        const promptTokens = usage.inputTokens || 0
        const completionTokens = usage.outputTokens || 0
        const totalTokens = usage.totalTokens || promptTokens + completionTokens

        // Send complete usage info
        onChunk({
          text: '',
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens
          },
          metrics: {
            completion_tokens: completionTokens,
            time_thinking_millsec:
              thinkingState.metrics.time_thinking_millsec > 0 ? thinkingState.metrics.time_thinking_millsec : undefined
          }
        })

        return true
      }
    }

    return false
  }

  /**
   * Handle metadata
   */
  private static handleMetadata(chunk: any, onChunk: (chunk: any) => void): boolean {
    if ('metadata' in chunk) {
      // Check if metadata contains thinking content
      const metadata = (chunk as any).metadata
      if (metadata && typeof metadata === 'object') {
        // Check if there's a thinking field
        if ('thinking' in metadata) {
          const thinkingContent = metadata.thinking
          let reasoningContent = ''

          if (typeof thinkingContent === 'string') {
            reasoningContent = thinkingContent
          } else if (thinkingContent && typeof thinkingContent === 'object') {
            reasoningContent = JSON.stringify(thinkingContent)
          }

          if (reasoningContent) {
            onChunk({
              reasoning_content: reasoningContent,
              text: ''
            })
            return true
          }
        }

        // Check if there's a metrics field
        if ('metrics' in metadata) {
          // Send metrics info
          onChunk({
            text: '',
            metrics: {
              latency_ms: metadata.metrics.latencyMs
            }
          })
        }
      }
    }
    return false
  }

  /**
   * Handle message stop event
   */
  private static async handleMessageStop(
    chunk: any,
    mcpTools: MCPTool[] | undefined,
    toolResponses: MCPToolResponse[],
    bedrockMessages: any[],
    client: BedrockClient,
    onChunk: (chunk: any) => void
  ): Promise<boolean> {
    if (chunk.messageStop) {
      // If stop reason is tool use
      if (chunk.messageStop.stopReason === 'tool_use') {
        try {
          // Use class property for modelId
          const modelId = this.currentModelId
          if (!modelId) {
            return false
          }

          // Filter message history to ensure each toolResult has a corresponding toolUse
          const filteredMessages = filterMessagesForToolUse(bedrockMessages)

          // Create system config and inference config
          const systemConfig = []
          const inferenceConfig = ToolChainHandler.createToolInferenceConfig(mcpTools)

          // Process tool chain recursively
          await ToolChainHandler.processToolChain(
            client,
            modelId,
            filteredMessages,
            systemConfig,
            inferenceConfig,
            mcpTools,
            toolResponses,
            bedrockMessages,
            onChunk
          )

          return true
        } catch (error) {
          return false
        }
      }
    }

    return false
  }

  /**
   * Handle tool use
   */
  private static async handleToolUse(
    chunk: any,
    mcpTools: MCPTool[] | undefined,
    toolResponses: MCPToolResponse[],
    bedrockMessages: any[],
    client: BedrockClient,
    onChunk: (chunk: any) => void
  ): Promise<boolean> {
    // Use generic method to find tool use
    const toolUse = this.findToolUseInResponse(chunk)

    if (toolUse) {
      // Process tool use
      await ToolHandler.processToolUse(toolUse, mcpTools, toolResponses, bedrockMessages, onChunk)

      // If stopped due to tool use, continue processing
      if (chunk.messageStop?.stopReason === 'tool_use') {
        // Use class property for modelId
        const modelId = this.currentModelId
        if (!modelId) {
          return true
        }

        // Filter messages for consistency of tool use and results
        const filteredMessages = filterMessagesForToolUse(bedrockMessages)

        // Create system config and inference config
        const systemConfig = []
        const inferenceConfig = ToolChainHandler.createToolInferenceConfig(mcpTools)

        // Process tool chain recursively
        await ToolChainHandler.processToolChain(
          client,
          modelId,
          filteredMessages,
          systemConfig,
          inferenceConfig,
          mcpTools,
          toolResponses,
          bedrockMessages,
          onChunk
        )
      }

      return true
    }

    return false
  }

  /**
   * Find tool use in response
   */
  private static findToolUseInResponse(response: any): any {
    // 1. Check response.output?.message?.content
    if (response.output?.message?.content) {
      for (const block of response.output.message.content) {
        if ('toolUse' in block && block.toolUse) {
          return block.toolUse
        }
      }
    }

    // 2. Check custom property response.message?.content
    const anyResponse = response as any
    if (anyResponse.message?.content) {
      for (const block of anyResponse.message.content) {
        if ('toolUse' in block && block.toolUse) {
          return block.toolUse
        }
      }
    }

    // 3. Check custom property in response.output
    if (response.output && 'toolUse' in response.output) {
      return response.output.toolUse
    }

    // 4. Directly check custom property in response
    if ('toolUse' in response) {
      return response.toolUse
    }

    return undefined
  }
}
