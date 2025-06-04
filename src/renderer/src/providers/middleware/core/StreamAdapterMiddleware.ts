import Logger from '@renderer/config/logger'
import { SdkRawChunk } from '@renderer/types/sdk'
import { asyncGeneratorToReadableStream } from '@renderer/utils/stream'

import { CompletionsParams, CompletionsResult } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'
import { isAsyncIterable } from '../utils'

export const MIDDLEWARE_NAME = 'StreamAdapterMiddleware'

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
export const StreamAdapterMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    // 调用下游中间件
    const result = await next(ctx, params)

    if (
      result.rawOutput &&
      !(result.rawOutput instanceof ReadableStream) &&
      isAsyncIterable<SdkRawChunk>(result.rawOutput)
    ) {
      const whatwgReadableStream: ReadableStream<SdkRawChunk> = asyncGeneratorToReadableStream<SdkRawChunk>(
        result.rawOutput
      )
      return {
        ...result,
        stream: whatwgReadableStream
      }
    } else if (result.rawOutput && result.rawOutput instanceof ReadableStream) {
      Logger.debug(`[${MIDDLEWARE_NAME}] Stream is already ReadableStream, passing through`)
      return {
        ...result,
        stream: result.rawOutput
      }
    }
    return result
  }
