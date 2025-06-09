import { Chunk, ChunkType, ErrorChunk } from '@renderer/types/chunk'

import { CompletionsResult } from '../schemas'
import { CompletionsContext } from '../types'

export const MIDDLEWARE_NAME = 'ErrorHandlerMiddleware'

/**
 * 将捕获到的未知错误解析为一个标准的ErrorChunk。
 * @param error - 捕获到的错误，类型未知。
 * @returns 一个标准化的 ErrorChunk 对象。
 */
function parseErrorToErrorChunk(error: unknown): ErrorChunk {
  // 确保我们处理的是一个Error实例
  const err = error instanceof Error ? error : new Error(String(error))

  return {
    type: ChunkType.ERROR,
    error: {
      message: err.message,
      name: err.name,
      stack: err.stack,
      // 尝试获取可能的错误码 (常见于API客户端错误)
      code: (err as any).code
    }
  }
}

/**
 * 错误处理中间件的配置选项。
 */
export interface ErrorHandlerMiddlewareConfig {
  /**
   * 是否在捕获错误后再次将其抛出。
   * - `true` (默认): 错误将继续向上传播，中断调用链。适用于需要调用方明确知道失败的场景。
   * - `false`: 错误将被捕获、处理，并作为一条ErrorChunk在流中向下传递。适用于希望UI统一处理流中所有类型数据（包括错误）的场景。
   */
  shouldThrow?: boolean
}

/**
 * 创建一个错误处理中间件。
 *
 * 这是一个高阶函数，它接收配置并返回一个标准的中间件。
 * 它的主要职责是捕获下游中间件或API调用中发生的任何错误。
 *
 * @param config - 中间件的配置。
 * @returns 一个配置好的CompletionsMiddleware。
 */
export const ErrorHandlerMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params): Promise<CompletionsResult> => {
    const { shouldThrow } = params

    try {
      // 尝试执行下一个中间件
      return await next(ctx, params)
    } catch (error: any) {
      // 1. 将错误解析为标准格式
      const errorChunk = parseErrorToErrorChunk(error)

      // 2. 调用从外部传入的 onError 回调
      if (params.onError) {
        params.onError(error)
      }

      // 3. 根据配置决定是重新抛出错误，还是将其作为流的一部分向下传递
      if (shouldThrow) {
        throw error
      }

      // 如果不抛出，则创建一个只包含该错误块的流并向下传递
      const errorStream = new ReadableStream<Chunk>({
        start(controller) {
          controller.enqueue(errorChunk)
          controller.close()
        }
      })

      return {
        rawOutput: undefined,
        stream: errorStream, // 将包含错误的流传递下去
        controller: undefined,
        getText: () => '' // 错误情况下没有文本结果
      }
    }
  }
