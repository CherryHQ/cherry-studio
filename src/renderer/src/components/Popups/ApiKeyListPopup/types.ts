import { Model } from '@renderer/types'

/**
 * API key 连通性检查的状态接口
 */
export type ApiKeyStatus = {
  key: string
  connectivity: 'success' | 'error' | 'not_checked'
  checking?: boolean
  error?: string
  model?: Model
  latency?: number
}

/**
 * API key 格式有效性
 */
export type ApiKeyValidity = {
  isValid: boolean
  error?: string
}
