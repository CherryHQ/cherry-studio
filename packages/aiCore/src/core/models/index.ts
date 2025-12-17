/**
 * Models 模块统一导出 - 简化版
 */

// 核心模型解析器
export { globalModelResolver, ModelResolver } from './ModelResolver'

// 保留的类型定义（可能被其他地方使用）
export type { ModelConfig as ModelConfigType } from './types'
