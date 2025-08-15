/**
 * Runtime 层类型定义
 */
import { type ModelConfig } from '../models/types'
import { type AiPlugin } from '../plugins'
import { type ProviderId } from '../providers/types'

/**
 * 运行时执行器配置
 */
export interface RuntimeConfig<T extends ProviderId = ProviderId> {
  providerId: T
  providerSettings: ModelConfig<T>['providerSettings'] & { mode?: 'chat' | 'responses' }
  plugins?: AiPlugin[]
}
