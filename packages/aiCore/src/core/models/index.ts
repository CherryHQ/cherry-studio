/**
 * Models 模块统一导出 - 简化版
 */

// 保留的类型定义（可能被其他地方使用）
export type { ModelConfig as ModelConfigType } from './types'

// 模型工具函数
export { hasModelId, isV2Model, isV3Model } from './utils'
