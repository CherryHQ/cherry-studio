import type {
  ContentBlock,
  ContentBlockParam,
  RedactedThinkingBlockParam,
  ServerToolUseBlockParam,
  TextBlockParam,
  ThinkingBlockParam,
  ToolUseBlockParam,
  WebSearchToolResultBlockParam
} from '@anthropic-ai/sdk/resources'
import { AnthropicAPIClient } from '@renderer/providers/AiProvider/clients/anthropic/AnthropicAPIClient'
import { AnthropicSdkRawChunk, AnthropicSdkRawOutput } from '@renderer/types/sdk'

import { AnthropicStreamListener } from '../../AiProvider/clients/types'
import { CompletionsParams, CompletionsResult } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'RawStreamListenerMiddleware'

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

export const RawStreamListenerMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const result = await next(ctx, params)

    // 在这里可以监听到从SDK返回的最原始流
    if (result.rawOutput) {
      console.log(`[${MIDDLEWARE_NAME}] 检测到原始SDK输出，准备附加监听器`)

      const providerType = ctx.apiClientInstance.provider.type
      // TODO: 后面下放到AnthropicAPIClient
      if (providerType === 'anthropic') {
        const anthropicListener: AnthropicStreamListener<AnthropicSdkRawChunk> = {
          onMessage: (message) => {
            console.log(`[${MIDDLEWARE_NAME}] 💬 Anthropic message:`, {
              id: message.id,
              role: message.role,
              contentLength: message.content?.length || 0
            })
            if (ctx._internal?.toolProcessingState) {
              // 将完整的 Message 转换为 MessageParam 格式，去除不需要的额外字段
              // 同时将 ContentBlock 数组转换为 ContentBlockParam 数组
              const messageParam = {
                role: message.role,
                content: convertContentBlocksToParams(message.content)
              }
              ctx._internal.toolProcessingState.assistantMessage = messageParam
            }
          },
          onContentBlock: (contentBlock) => {
            console.log(`[${MIDDLEWARE_NAME}] 📝 Anthropic content block:`, contentBlock.type)
          }
        }

        const specificApiClient = ctx.apiClientInstance as AnthropicAPIClient

        const monitoredOutput = specificApiClient.attachRawStreamListener(
          result.rawOutput as AnthropicSdkRawOutput,
          anthropicListener
        )
        return {
          ...result,
          rawOutput: monitoredOutput
        }
      }
    }

    return result
  }
