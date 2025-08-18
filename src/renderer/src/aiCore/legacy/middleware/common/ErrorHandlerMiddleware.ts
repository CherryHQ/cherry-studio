import { loggerService } from '@logger'
import { Chunk } from '@renderer/types/chunk'

import { CompletionsResult } from '../schemas'
import { CompletionsContext } from '../types'
import { createErrorChunk } from '../utils'

const logger = loggerService.withContext('ErrorHandlerMiddleware')

export const MIDDLEWARE_NAME = 'ErrorHandlerMiddleware'

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
      logger.error('ErrorHandlerMiddleware_error', error)
      // 1. 使用通用的工具函数将错误解析为标准格式
      const errorChunk = createErrorChunk(error)
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
