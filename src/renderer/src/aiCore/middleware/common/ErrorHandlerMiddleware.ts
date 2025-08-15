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
      // 智谱错误测试模式 - 仅在开发环境或明确设置时启用
      const testZhipuError = localStorage.getItem('test_zhipu_error')
      if (testZhipuError && isZhipuModel(params.assistant.model)) {
        logger.debug('🔧 智谱错误测试模式已激活:', { testError: testZhipuError })
        const testError = createTestZhipuError(testZhipuError)
        throw testError
      }

      // 尝试执行下一个中间件
      return await next(ctx, params)
    } catch (error: any) {
      logger.error('ErrorHandlerMiddleware_error', error)

      // 智谱特定错误处理
      let processedError = error
      logger.debug('🔧 检查是否为智谱模型:', {
        modelId: params.assistant.model?.id,
        isZhipuModel: isZhipuModel(params.assistant.model),
        errorStatus: error.status
      })

      if (isZhipuModel(params.assistant.model) && error.status) {
        logger.debug('🔧 开始处理智谱错误:', {
          originalError: error,
          provider: params.assistant.provider
        })
        processedError = handleZhipuError(error, params.assistant.provider || {})
        logger.debug('🔧 智谱错误处理完成:', processedError)
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

  logger.debug('🔧 开始处理智谱错误:', {
    error,
    provider,
    hasProvider: !!provider,
    hasApiKey: !!(provider && provider.apiKey),
    apiKeyLength: provider?.apiKey?.length
  })

  // 检查401错误（令牌过期或验证不正确）
  if (
    error.status === 401 ||
    (error.message &&
      (error.message.includes('令牌已过期') ||
        error.message.includes('验证不正确') ||
        error.message.includes('AuthenticationError') ||
        error.message.includes('Unauthorized')))
  ) {
    logger.debug('🔧 检测到401错误，返回zhipu.no_api_key')
    return {
      ...error,
      message: 'zhipu.no_api_key'
    }
  }

  // 检查免费配额用尽错误（优先级更高，先检查）
  if (
    error.status === 429 ||
    (error.message &&
      (error.message.includes('免费配额') ||
        error.message.includes('free quota') ||
        error.message.includes('rate limit')))
  ) {
    logger.debug('🔧 检测到配额用尽错误，返回zhipu.quota_exceeded')
    return {
      ...error,
      message: 'zhipu.quota_exceeded'
    }
  }

  // 检查余额不足错误 (通常状态码为402或特定错误消息)
  if (
    error.status === 402 ||
    (error.message && (error.message.includes('余额不足') || error.message.includes('insufficient balance')))
  ) {
    logger.debug('🔧 检测到余额不足错误，返回zhipu.insufficient_balance')
    return {
      ...error,
      message: 'zhipu.insufficient_balance'
    }
  }

  // 检查API Key是否配置（放在最后，避免覆盖其他错误类型）
  if (!provider || !provider.apiKey || provider.apiKey.trim() === '') {
    logger.debug('🔧 API Key未配置，返回zhipu.no_api_key')
    return {
      ...error,
      message: 'zhipu.no_api_key'
    }
  }

  // 如果不是智谱特定错误，返回原始错误
  logger.debug('🔧 不是智谱特定错误，返回原始错误')
  return error
}

/**
 * 创建测试用的智谱错误
 */
function createTestZhipuError(errorType: string): any {
  switch (errorType) {
    case 'no_api_key':
      return {
        name: 'ZhipuError',
        message: 'API key is required',
        status: 401
      }
    case 'insufficient_balance':
      return {
        name: 'ZhipuError',
        message: '余额不足 insufficient balance',
        status: 402
      }
    case 'quota_exceeded':
      return {
        name: 'ZhipuError',
        message: '免费配额已用尽 free quota exceeded',
        status: 429
      }
    default:
      return {
        name: 'ZhipuError',
        message: 'Unknown error',
        status: 500
      }
  }
}
