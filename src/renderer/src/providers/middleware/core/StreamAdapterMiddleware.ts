import { SdkRawChunk } from '@renderer/providers/AiProvider/clients'
import { asyncGeneratorToReadableStream } from '@renderer/utils/stream'

import { CompletionsMiddleware } from '../type'

const MIDDLEWARE_NAME = 'StreamAdapterMiddleware'

/**
 * 流适配器中间件
 *
 * 职责：
 * 1. 检测ctx._internal.apiCall.rawSdkOutput（优先）或原始AsyncIterable流
 * 2. 将AsyncIterable转换为WHATWG ReadableStream
 * 3. 更新响应结果中的stream
 *
 * 注意：如果ResponseTransformMiddleware已处理过，会优先使用transformedStream
 */
export const StreamAdapterMiddleware: CompletionsMiddleware = async (ctx, next) => {
  // 调用下游中间件
  await next()

  // 响应后处理：处理流适配
  if (ctx._internal?.apiCall?.rawSdkOutput) {
    const originalResult = ctx._internal.apiCall.rawSdkOutput

    console.log('🚀 StreamAdapterMiddleware (Raw): Original result received:', originalResult)

    // 优先检查是否有转换后的流
    if (isAsyncIterable(originalResult)) {
      console.log(`[${MIDDLEWARE_NAME}] Using transformedStream from ctx._internal.apiCall.rawSdkOutput`)

      const rawSdkAsAsyncIterable = originalResult as AsyncIterable<SdkRawChunk>

      const whatwgReadableStream: ReadableStream<SdkRawChunk> = asyncGeneratorToReadableStream(rawSdkAsAsyncIterable)

      ctx._internal.apiCall.rawSdkStream = whatwgReadableStream

      console.log(`[${MIDDLEWARE_NAME}] Successfully adapted transformedStream to ReadableStream`)
    } else if (originalResult instanceof ReadableStream) {
      console.log(`[${MIDDLEWARE_NAME}] Stream is already ReadableStream, passing through`)
    } else {
      console.warn(`[${MIDDLEWARE_NAME}] Stream is neither ReadableStream nor AsyncIterable, passing through`)
    }
  }
  return
}

/**
 * 检查对象是否实现了AsyncIterable接口
 */
function isAsyncIterable<T = unknown>(obj: unknown): obj is AsyncIterable<T> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof (obj as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
  )
}
