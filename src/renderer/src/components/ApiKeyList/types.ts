/**
 * API key 状态接口
 */
export interface ApiKeyStatus {
  key: string
  isValid?: boolean
  checking?: boolean
  error?: string
  model?: any
  latency?: number
}

/**
 * API key 验证结果接口
 */
export interface ApiKeyValidationResult {
  isValid: boolean
  error?: 'empty_key' | 'duplicate_key' | 'invalid_format'
}
