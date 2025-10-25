/**
 * 模型包装工具函数
 * 用于将中间件应用到LanguageModel上
 */
import { LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'

/**
 * 使用中间件包装模型
 */
export function wrapModelWithMiddlewares(
  model: LanguageModelV3,
  middlewares: LanguageModelV3Middleware[]
): LanguageModelV3 {
  if (middlewares.length === 0) {
    return model
  }

  return wrapLanguageModel({
    model,
    middleware: middlewares
  })
}
