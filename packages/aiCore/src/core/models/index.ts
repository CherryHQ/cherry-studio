/**
 * Models 模块导出
 * 提供统一的模型创建和配置管理能力
 */

// 主要的模型创建API
export { createModel, createModels } from './factory'

// 底层Provider创建功能（供高级用户使用）
export {
  createBaseModel,
  createImageModel,
  getProviderInfo,
  getSupportedProviders,
  ProviderCreationError
} from './ProviderCreator'

// 保留原有类型
export type { ModelConfig } from './types'
