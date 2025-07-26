import { AnthropicAPIClient } from '@renderer/aiCore/clients/anthropic/AnthropicAPIClient'
import { isAnthropicModel } from '@renderer/config/models'
import { AnthropicSdkRawChunk, AnthropicSdkRawOutput } from '@renderer/types/sdk'

import { AnthropicStreamListener } from '../../clients/types'
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
      const model = params.assistant.model
      // TODO: 后面下放到AnthropicAPIClient
      if (isAnthropicModel(model)) {
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
    }

    return result
  }
