/**
 * 中间件系统类型定义
 */
import { LanguageModelV1Middleware } from 'ai'

/**
 * 具名中间件接口
 */
export interface NamedMiddleware {
  name: string
  middleware: LanguageModelV1Middleware
}
