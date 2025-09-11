/**
 * 模型包装工具函数
 * 用于将中间件应用到LanguageModel上
 */
import { LanguageModelV2, LanguageModelV2Middleware } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'

/**
 * 使用中间件包装模型
 */
export function wrapModelWithMiddlewares(
  model: LanguageModelV2,
  middlewares: LanguageModelV2Middleware[]
): LanguageModelV2 {
  if (middlewares.length === 0) {
    return model
  }

  return wrapLanguageModel({
    model,
    middleware: middlewares
  })
}
