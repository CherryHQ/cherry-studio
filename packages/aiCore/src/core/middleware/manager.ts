/**
 * 中间件管理器
 * 专注于 AI SDK 中间件的管理，与插件系统分离
 */
import { LanguageModelV3Middleware } from '@ai-sdk/provider'

/**
 * 创建中间件列表
 * 合并用户提供的中间件
 */
export function createMiddlewares(userMiddlewares: LanguageModelV3Middleware[] = []): LanguageModelV3Middleware[] {
  // 未来可以在这里添加默认的中间件
  const defaultMiddlewares: LanguageModelV3Middleware[] = []

  return [...defaultMiddlewares, ...userMiddlewares]
}
