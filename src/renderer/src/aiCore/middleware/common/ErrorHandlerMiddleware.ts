import { loggerService } from '@logger'
import { isZhipuModel } from '@renderer/config/models'
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

      // 智谱特定错误处理
      let processedError = error

      // 只有对话功能（enableGenerateImage为false）才使用自定义错误处理
      // 绘画功能（enableGenerateImage为true）使用通用错误处理
      if (isZhipuModel(params.assistant.model) && error.status && !params.enableGenerateImage) {
        processedError = handleZhipuError(error, params.assistant.provider || {})
      }

      // 1. 使用通用的工具函数将错误解析为标准格式
      const errorChunk = createErrorChunk(processedError)
      // 2. 调用从外部传入的 onError 回调
      if (params.onError) {
        params.onError(processedError)
      }

      // 3. 根据配置决定是重新抛出错误，还是将其作为流的一部分向下传递
      if (shouldThrow) {
        throw processedError
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

/**
 * 处理智谱特定错误
 */
function handleZhipuError(error: any, provider: any): any {
  const logger = loggerService.withContext('handleZhipuError')
  // 检查401错误（令牌过期或验证不正确）
  if (
    error.status === 401 ||
    (error.message &&
      (error.message.includes('令牌已过期') ||
        error.message.includes('AuthenticationError') ||
        error.message.includes('Unauthorized')))
  ) {
    return {
      ...error,
      message: 'zhipu.no_api_key'
    }
  }

  // 检查免费配额用尽错误（优先级更高，先检查）
  if (
    error.error?.code === '1304' ||
    (error.message &&
      (error.message.includes('限额') ||
        error.message.includes('免费配额') ||
        error.message.includes('free quota') ||
        error.message.includes('rate limit')))
  ) {
    return {
      ...error,
      message: 'zhipu.quota_exceeded'
    }
  }

  // 检查余额不足错误 (通常状态码为429或特定错误消息)
  if (
    (error.status === 429 && error.error?.code === '1113') ||
    (error.message && (error.message.includes('余额不足') || error.message.includes('insufficient balance')))
  ) {
    return {
      ...error,
      message: 'zhipu.insufficient_balance'
    }
  }

  // 检查API Key是否配置（放在最后，避免覆盖其他错误类型）
  if (!provider || !provider.apiKey || provider.apiKey.trim() === '') {
    return {
      ...error,
      message: 'zhipu.no_api_key'
    }
  }

  // 如果不是智谱特定错误，返回原始错误
  logger.debug('🔧 不是智谱特定错误，返回原始错误')
  return error
}
