import { BedrockClient } from '../client/BedrockClient'
import { InferenceConfig, SystemConfig, ThinkingConfig } from '../client/types'

/**
 * Non-Stream Response Handler
 * Handles non-streaming response processing
 */
export class NonStreamHandler {
  /**
   * Process non-streaming response
   *
   * @param client Bedrock client
   * @param modelId Model ID
   * @param bedrockMessages Bedrock messages
   * @param systemConfig System configuration
   * @param inferenceConfig Inference configuration
   * @param thinkingConfig Thinking configuration
   * @param onChunk Chunk callback
   */
  public static async handle(
    client: BedrockClient,
    modelId: string,
    bedrockMessages: any[],
    systemConfig: SystemConfig,
    inferenceConfig: InferenceConfig,
    thinkingConfig: ThinkingConfig | undefined,
    onChunk: (chunk: any) => void
  ): Promise<void> {
    // Non-streaming request
    const response = await client.converse(modelId, bedrockMessages, systemConfig, inferenceConfig)

    // Extract response text and thinking content
    let text = ''
    let reasoningContent = ''

    // Process response content
    if (response.output?.message?.content) {
      for (const block of response.output.message.content) {
        // Check for tool use
        if (block.toolUse) {
          onChunk({ text: '', toolUse: block.toolUse })
        }

        // Process text content
        if ('text' in block && block.text) {
          text += block.text
        }

        // Process thinking content
        reasoningContent = this.extractReasoningContent(block, thinkingConfig)
      }
    }

    // Process usage information
    const usageInfo = response.usage
      ? {
          prompt_tokens: response.usage.inputTokens || 0,
          completion_tokens: response.usage.outputTokens || 0,
          total_tokens:
            response.usage.totalTokens || (response.usage.inputTokens || 0) + (response.usage.outputTokens || 0)
        }
      : undefined

    // Process metadata
    const metricsInfo = response.$metadata
      ? {
          latency_ms: (response.$metadata as any).latencyMs,
          completion_tokens: usageInfo?.completion_tokens
        }
      : undefined

    // Send complete response
    onChunk({
      text,
      reasoning_content: reasoningContent,
      usage: usageInfo,
      metrics: metricsInfo
    })
  }

  /**
   * Extract reasoning content from response block
   *
   * @param block Response block
   * @param thinkingConfig Thinking configuration
   * @returns Reasoning content
   */
  private static extractReasoningContent(block: any, thinkingConfig: ThinkingConfig | undefined): string {
    // If no thinking configuration, return empty string
    if (!thinkingConfig) return ''

    // Check for thinking content
    if ('thinking' in block) {
      const thinking = block.thinking
      if (typeof thinking === 'string') {
        return thinking
      } else if (thinking && typeof thinking === 'object') {
        if ('text' in thinking && typeof thinking.text === 'string') {
          return thinking.text
        } else if ('content' in thinking && typeof thinking.content === 'string') {
          return thinking.content
        } else {
          return JSON.stringify(thinking)
        }
      }
    }

    // Check for reasoning content (DeepSeek)
    if ('reasoning' in block) {
      const reasoning = block.reasoning
      return typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning)
    }

    return ''
  }
}
