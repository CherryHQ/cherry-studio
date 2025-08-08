import { Model, Provider } from '@types'

/**
 * 健康检查的通用状态枚举
 * - SUCCESS: 用于表达“所有都成功”
 * - FAILED: 用于表达“至少一个失败”
 */
export enum HealthStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  NOT_CHECKED = 'not_checked'
}

/**
 * API Key 连通性检查的状态
 */
export interface ApiKeyConnectivity {
  status: HealthStatus
  checking?: boolean
  error?: string
  model?: Model
  latency?: number
}

/**
 * API key 及其连通性检查的状态
 */
export interface ApiKeyWithStatus extends ApiKeyConnectivity {
  key: string
}

/**
 * 模型及其连通性检查的状态
 */
export interface ModelWithStatus {
  model: Model
  status: HealthStatus
  keyResults: ApiKeyWithStatus[]
  checking?: boolean
  latency?: number
  error?: string
}

/**
 * 模型健康检查选项
 */
export interface ModelCheckOptions {
  provider: Provider
  models: Model[]
  apiKeys: string[]
  isConcurrent: boolean
  timeout?: number
}
