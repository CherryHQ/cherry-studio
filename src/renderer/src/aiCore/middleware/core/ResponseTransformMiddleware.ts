import Logger from '@renderer/config/logger'
import { SdkRawChunk } from '@renderer/types/sdk'

import { ResponseChunkTransformerContext } from '../../clients/types'
import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'ResponseTransformMiddleware'

/**
 * 响应转换中间件
 *
 * 职责：
 * 1. 检测ReadableStream类型的响应流
 * 2. 使用ApiClient的getResponseChunkTransformer()将原始SDK响应块转换为通用格式
 * 3. 将转换后的ReadableStream保存到ctx._internal.apiCall.genericChunkStream，供下游中间件使用
 *
 * 注意：此中间件应该在StreamAdapterMiddleware之后执行
 */
export const ResponseTransformMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：转换原始SDK响应块
    if (result.stream) {
      const adaptedStream = result.stream

      // 处理ReadableStream类型的流
      if (adaptedStream instanceof ReadableStream) {
        const apiClient = ctx.apiClientInstance
        if (!apiClient) {
          console.error(`[${MIDDLEWARE_NAME}] ApiClient instance not found in context`)
          throw new Error('ApiClient instance not found in context')
        }

        // 获取响应转换器
        const responseChunkTransformer = apiClient.getResponseChunkTransformer(ctx)
        if (!responseChunkTransformer) {
          Logger.warn(`[${MIDDLEWARE_NAME}] No ResponseChunkTransformer available, skipping transformation`)
          return result
        }

        const assistant = params.assistant
        const model = assistant?.model

        if (!assistant || !model) {
          console.error(`[${MIDDLEWARE_NAME}] Assistant or Model not found for transformation`)
          throw new Error('Assistant or Model not found for transformation')
        }

        const transformerContext: ResponseChunkTransformerContext = {
          isStreaming: params.streamOutput || false,
          isEnabledToolCalling: (params.mcpTools && params.mcpTools.length > 0) || false,
          isEnabledWebSearch: params.enableWebSearch || false,
          isEnabledUrlContext: params.enableUrlContext || false,
          isEnabledReasoning: params.enableReasoning || false,
          mcpTools: params.mcpTools || [],
          provider: ctx.apiClientInstance?.provider
        }

        console.log(`[${MIDDLEWARE_NAME}] Transforming raw SDK chunks with context:`, transformerContext)

        try {
          // 创建转换后的流
          const genericChunkTransformStream = (adaptedStream as ReadableStream<SdkRawChunk>).pipeThrough<GenericChunk>(
            new TransformStream<SdkRawChunk, GenericChunk>(responseChunkTransformer(transformerContext))
          )

          // 将转换后的ReadableStream保存到result，供下游中间件使用
          return {
            ...result,
            stream: genericChunkTransformStream
          }
        } catch (error) {
          Logger.error(`[${MIDDLEWARE_NAME}] Error during chunk transformation:`, error)
          throw error
        }
      }
    }

    // 如果没有流或不是ReadableStream，返回原始结果
    return result
  }
