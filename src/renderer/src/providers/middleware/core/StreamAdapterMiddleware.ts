import Logger from '@renderer/config/logger'
import { ChunkType } from '@renderer/types/chunk'
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
    // TODO:调用开始，因为这个是最靠近接口请求的地方，next执行代表着开始接口请求了
    // 但是这个中间件的职责是流适配，是否在这调用优待商榷
    params.onChunk({ type: ChunkType.LLM_RESPONSE_CREATED })
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
