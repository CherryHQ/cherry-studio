/**
 * Providers 模块统一导出 - 独立Provider包
 */

// ==================== 核心管理器 ====================

// Provider 注册表管理器
export { globalRegistryManagement, RegistryManagement } from './RegistryManagement'

// Provider 核心功能
export {
  // 状态管理
  cleanup,
  clearAllProviders,
  createAndRegisterProvider,
  createProvider,
  getAllProviderConfigAliases,
  getAllProviderConfigs,
  getImageModel,
  // 工具函数
  getInitializedProviders,
  getLanguageModel,
  getProviderConfig,
  getProviderConfigByAlias,
  getSupportedProviders,
  getTextEmbeddingModel,
  hasInitializedProviders,
  // 工具函数
  hasProviderConfig,
  // 别名支持
  hasProviderConfigByAlias,
  isProviderConfigAlias,
  // 错误类型
  ProviderInitializationError,
  // 全局访问
  providerRegistry,
  registerMultipleProviderConfigs,
  registerProvider,
  // 统一Provider系统
  registerProviderConfig,
  resolveProviderConfigId
} from './registry'

// ==================== 基础数据和类型 ====================

// 基础Provider数据源
export { baseProviderIds, baseProviders } from './schemas'

// 类型定义和Schema
export type {
  BaseProviderId,
  CustomProviderId,
  DynamicProviderRegistration,
  ProviderConfig,
  ProviderId
} from './schemas' // 从 schemas 导出的类型
export { baseProviderIdSchema, customProviderIdSchema, providerConfigSchema, providerIdSchema } from './schemas' // Schema 导出
export type {
  DynamicProviderRegistry,
  ExtensibleProviderSettingsMap,
  ProviderError,
  ProviderSettingsMap,
  ProviderTypeRegistrar
} from './types'

// ==================== 工具函数 ====================

// Provider配置工厂
export {
  type BaseProviderConfig,
  createProviderConfig,
  ProviderConfigBuilder,
  providerConfigBuilder,
  ProviderConfigFactory
} from './factory'

// 工具函数
export { formatPrivateKey } from './utils'

// ==================== 扩展功能 ====================

// Hub Provider 功能
export { createHubProvider, type HubProviderConfig, HubProviderError } from './HubProvider'
