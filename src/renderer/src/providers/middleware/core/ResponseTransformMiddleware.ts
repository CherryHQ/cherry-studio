import { SdkRawChunk } from '@renderer/types/sdk'

import { ResponseChunkTransformerContext } from '../../AiProvider/clients/types'
import { GenericChunk } from '../schemas'
import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'ResponseTransformMiddleware'

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
export const ResponseTransformMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：转换原始SDK响应块
  if (ctx._internal.apiCall && ctx._internal.apiCall.rawSdkStream) {
    const adaptedStream = ctx._internal.apiCall.rawSdkStream

    console.log(`[${MIDDLEWARE_NAME}] Processing result, has stream: ${!!adaptedStream}`)

    // 处理ReadableStream类型的流
    if (adaptedStream instanceof ReadableStream) {
      const apiClient = ctx.apiClientInstance
      if (!apiClient) {
        console.error(`[${MIDDLEWARE_NAME}] ApiClient instance not found in context`)
        throw new Error('ApiClient instance not found in context')
      }

      // 获取响应转换器
      const responseChunkTransformer = apiClient.getResponseChunkTransformer?.()
      if (!responseChunkTransformer) {
        console.log(`[${MIDDLEWARE_NAME}] No ResponseChunkTransformer available, skipping transformation`)
        return
      }

      // 准备转换器上下文
      const params = ctx.originalParams
      const assistant = params.assistant
      const model = assistant?.model

      if (!assistant || !model) {
        console.error(`[${MIDDLEWARE_NAME}] Assistant or Model not found for transformation`)
        throw new Error('Assistant or Model not found for transformation')
      }

      const transformerContext: ResponseChunkTransformerContext = {
        isStreaming: true,
        isEnabledToolCalling: assistant.settings?.toolUseMode === 'function' || false,
        isEnabledWebSearch: assistant.enableWebSearch || false,
        isEnabledReasoning: assistant.settings?.reasoning_effort !== undefined || false,
        mcpTools: params.mcpTools || []
      }

      console.log(`[${MIDDLEWARE_NAME}] Transforming raw SDK chunks with context:`, transformerContext)

      try {
        // 创建转换后的异步迭代器
        const genericChunkTransformStream = adaptedStream.pipeThrough<GenericChunk>(
          new TransformStream({
            async transform(chunk: SdkRawChunk, controller) {
              const transformedChunks = responseChunkTransformer(chunk, transformerContext)
              for await (const genericChunk of transformedChunks) {
                controller.enqueue(genericChunk)
              }
            }
          })
        )

        // 将转换后的AsyncIterable保存到ctx.state，供下游中间件使用
        ctx._internal.apiCall.genericChunkStream = genericChunkTransformStream
        console.log(
          `[${MIDDLEWARE_NAME}] Successfully transformed raw SDK chunks and saved to ctx.state.transformedStream`
        )
      } catch (error) {
        console.error(`[${MIDDLEWARE_NAME}] Error during chunk transformation:`, error)
        throw error
      }
    }
  }
}
