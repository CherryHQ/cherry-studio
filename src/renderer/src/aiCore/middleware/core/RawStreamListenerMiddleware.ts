import { AnthropicAPIClient } from '@renderer/aiCore/clients/anthropic/AnthropicAPIClient'
import { OpenAIResponseAPIClient } from '@renderer/aiCore/clients/openai/OpenAIResponseAPIClient'
import {
  AnthropicSdkRawChunk,
  AnthropicSdkRawOutput,
  OpenAIResponseSdkRawChunk,
  OpenAIResponseSdkRawOutput
} from '@renderer/types/sdk'

import { AnthropicStreamListener, OpenAIResponseStreamListener } from '../../clients/types'
import { CompletionsParams, CompletionsResult } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'RawStreamListenerMiddleware'

export const RawStreamListenerMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const result = await next(ctx, params)

    // 在这里可以监听到从SDK返回的最原始流
    if (result.rawOutput) {
      const providerType = ctx.apiClientInstance.provider.type
      // TODO: 后面下放到AnthropicAPIClient
      if (providerType === 'anthropic') {
        const anthropicListener: AnthropicStreamListener<AnthropicSdkRawChunk> = {
          onMessage: (message) => {
            if (ctx._internal?.toolProcessingState) {
              ctx._internal.toolProcessingState.output = message
            }
          }
          // onContentBlock: (contentBlock) => {
          //   console.log(`[${MIDDLEWARE_NAME}] 📝 Anthropic content block:`, contentBlock.type)
          // }
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
      if (providerType === 'openai-response') {
        const openaiListener: OpenAIResponseStreamListener<OpenAIResponseSdkRawChunk> = {
          onMessage: (output) => {
            if (ctx._internal?.toolProcessingState) {
              ctx._internal.toolProcessingState.output = output
            }
          }
        }
        const specificApiClient = ctx.apiClientInstance as OpenAIResponseAPIClient
        const monitoredOutput = await specificApiClient.attachRawStreamListener(
          result.rawOutput as OpenAIResponseSdkRawOutput,
          openaiListener
        )
        return {
          ...result,
          rawOutput: monitoredOutput
        }
      }
    }

    return result
  }
