import { MCPTool, MCPToolResponse } from '@renderer/types'

import { BedrockClient } from '../client/BedrockClient'
import { InferenceConfig } from '../client/types'
import { createToolConfig, filterMessagesForToolUse } from '../utils/ToolUtils'
import { ToolHandler } from './ToolHandler'

/**
 * Tool Chain Handler
 * Handles recursive processing of tool chains
 */
export class ToolChainHandler {
  /**
   * Process tool chain
   * @param client Bedrock client
   * @param modelId Model ID
   * @param messages Messages
   * @param systemConfig System configuration
   * @param inferenceConfig Inference configuration
   * @param mcpTools MCP tools
   * @param toolResponses Tool responses
   * @param bedrockMessages Bedrock messages
   * @param onChunk Chunk callback
   */
  public static async processToolChain(
    client: BedrockClient,
    modelId: string,
    messages: any[],
    systemConfig: any[],
    inferenceConfig: InferenceConfig,
    mcpTools: MCPTool[] | undefined,
    toolResponses: MCPToolResponse[],
    bedrockMessages: any[],
    onChunk: (chunk: any) => void
  ): Promise<void> {
    // Send request and get response
    try {
      const response = await client.converse(modelId, messages, systemConfig, inferenceConfig)
      // Extract text content from response
      const text = this.extractTextFromResponse(response)
      if (text) {
        onChunk({ text })
      }

      // Process usage information
      if (response.usage) {
        onChunk({
          text: '',
          usage: {
            prompt_tokens: response.usage.inputTokens || 0,
            completion_tokens: response.usage.outputTokens || 0,
            total_tokens:
              response.usage.totalTokens || (response.usage.inputTokens || 0) + (response.usage.outputTokens || 0)
          }
        })
      }

      // Check for tool use
      const toolUse = this.findToolUseInResponse(response)

      // If tool use is found, process it and recursively continue processing
      if (toolUse) {
        // Process tool use
        await ToolHandler.processToolUse(toolUse, mcpTools, toolResponses, bedrockMessages, onChunk)

        // Filter messages to ensure tool use and result consistency
        const updatedMessages = filterMessagesForToolUse(bedrockMessages)

        // Recursively process next tool use
        if (response.stopReason === 'tool_use') {
          await this.processToolChain(
            client,
            modelId,
            updatedMessages,
            systemConfig,
            inferenceConfig,
            mcpTools,
            toolResponses,
            bedrockMessages,
            onChunk
          )
        }
      }
    } catch (error) {
      onChunk({ text: error })
      return
    }
  }

  /**
   * Create tool inference configuration
   * @param mcpTools MCP tools
   * @returns Inference configuration
   */
  public static createToolInferenceConfig(mcpTools: MCPTool[] | undefined): InferenceConfig {
    const toolConfig = createToolConfig(mcpTools)

    return {
      maxTokens: 4096,
      temperature: 0.7,
      toolConfig
    }
  }

  /**
   * Extract text from response
   * @param response Response object
   * @returns Text content
   */
  private static extractTextFromResponse(response: any): string {
    let text = ''

    // Check output.message.content
    if (response.output?.message?.content) {
      for (const block of response.output.message.content) {
        if ('text' in block && block.text) {
          text += block.text
        }
      }
    }

    // Check custom property response.message?.content
    const anyResponse = response as any
    if (anyResponse.message?.content) {
      for (const block of anyResponse.message.content) {
        if ('text' in block && block.text) {
          text += block.text
        }
      }
    }

    return text
  }

  /**
   * Find tool use in response
   * @param response Response object
   * @returns Tool use object, or undefined if not found
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
