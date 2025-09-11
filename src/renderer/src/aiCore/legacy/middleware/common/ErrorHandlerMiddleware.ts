import { loggerService } from '@logger'
import { isZhipuModel } from '@renderer/config/models'
import store from '@renderer/store'
import { Chunk } from '@renderer/types/chunk'

import { CompletionsParams, CompletionsResult } from '../schemas'
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
      logger.error(error)

      let processedError = error
      processedError = handleError(error, params)

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

function handleError(error: any, params: CompletionsParams): any {
  if (isZhipuModel(params.assistant.model) && error.status && !params.enableGenerateImage) {
    return handleZhipuError(error)
  }

  if (error.status === 401 || error.message.includes('401')) {
    return {
      ...error,
      i18nKey: 'chat.no_api_key',
      providerId: params.assistant?.model?.provider
    }
  }

  return error
}

/**
 * 处理智谱特定错误
 * 1. 只有对话功能（enableGenerateImage为false）才使用自定义错误处理
 * 2. 绘画功能（enableGenerateImage为true）使用通用错误处理
 */
function handleZhipuError(error: any): any {
  const provider = store.getState().llm.providers.find((p) => p.id === 'zhipu')
  const logger = loggerService.withContext('handleZhipuError')

  // 定义错误模式映射
  const errorPatterns = [
    {
      condition: () => error.status === 401 || /令牌已过期|AuthenticationError|Unauthorized/i.test(error.message),
      i18nKey: 'chat.no_api_key',
      providerId: provider?.id
    },
    {
      condition: () => error.error?.code === '1304' || /限额|免费配额|free quota|rate limit/i.test(error.message),
      i18nKey: 'chat.quota_exceeded',
      providerId: provider?.id
    },
    {
      condition: () =>
        (error.status === 429 && error.error?.code === '1113') || /余额不足|insufficient balance/i.test(error.message),
      i18nKey: 'chat.insufficient_balance',
      providerId: provider?.id
    },
    {
      condition: () => !provider?.apiKey?.trim(),
      i18nKey: 'chat.no_api_key',
      providerId: provider?.id
    }
  ]

  // 遍历错误模式，返回第一个匹配的错误
  for (const pattern of errorPatterns) {
    if (pattern.condition()) {
      return {
        ...error,
        providerId: pattern.providerId,
        i18nKey: pattern.i18nKey
      }
    }
  }

  // 如果不是智谱特定错误，返回原始错误
  logger.debug('🔧 不是智谱特定错误，返回原始错误')

  return error
}
