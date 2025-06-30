/**
 * 模型包装工具函数
 * 用于将中间件应用到LanguageModel上
 */
import { LanguageModel, LanguageModelV1Middleware, wrapLanguageModel } from 'ai'

/**
 * 使用中间件包装模型
 */
export function wrapModelWithMiddlewares(
  model: LanguageModel,
  middlewares: LanguageModelV1Middleware[]
): LanguageModel {
  if (middlewares.length === 0) {
    return model
  }

  return wrapLanguageModel({
    model,
    middleware: middlewares
  })
}
