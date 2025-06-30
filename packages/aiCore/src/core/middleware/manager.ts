/**
 * 中间件管理器
 * 专注于 AI SDK 中间件的管理，与插件系统分离
 */
import { LanguageModelV1Middleware } from 'ai'

/**
 * 创建中间件列表
 * 合并用户提供的中间件
 */
export function createMiddlewares(userMiddlewares: LanguageModelV1Middleware[] = []): LanguageModelV1Middleware[] {
  // 未来可以在这里添加默认的中间件
  const defaultMiddlewares: LanguageModelV1Middleware[] = []

  return [...defaultMiddlewares, ...userMiddlewares]
}
