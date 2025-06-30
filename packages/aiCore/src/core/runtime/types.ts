/**
 * Runtime 层类型定义
 */
import { type ProviderId, type ProviderSettingsMap } from '../../types'
import { type AiPlugin } from '../plugins'

/**
 * 运行时执行器配置
 */
export interface RuntimeConfig<T extends ProviderId = ProviderId> {
  providerId: T
  options: ProviderSettingsMap[T]
  plugins?: AiPlugin[]
}

/**
 * 执行选项
 */
export interface ExecutionOptions {
  // 未来可以添加执行级别的选项
  // 比如：超时设置、重试机制等
}

// 保留旧类型以保持向后兼容
export interface ExecutorConfig<T extends ProviderId = ProviderId> extends RuntimeConfig<T> {}
