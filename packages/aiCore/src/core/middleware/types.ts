/**
 * 中间件系统类型定义
 */
import { LanguageModelV3Middleware } from '@ai-sdk/provider'

/**
 * 具名中间件接口
 */
export interface NamedMiddleware {
  name: string
  middleware: LanguageModelV3Middleware
}
