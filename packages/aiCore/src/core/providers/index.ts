/**
 * Providers 模块统一导出 - 独立Provider包
 */

// ==================== 核心管理器 ====================
export { globalProviderStorage } from './core/ProviderExtension'

// Provider 核心功能
export {
  clearAllProviders,
  coreExtensions,
  createProvider,
  getInitializedProviders,
  getSupportedProviders,
  hasInitializedProviders,
  hasProviderConfig,
  isRegisteredProvider,
  ProviderInitializationError,
  registeredProviderIds
} from './core/initialization'

// ==================== 基础数据和类型 ====================

// 类型定义
export type { AiSdkModel, ProviderError } from './types'

// 类型提取工具（用于应用层 Merge Point 模式）
export type {
  CoreProviderSettingsMap,
  ExtensionConfigToIdResolutionMap,
  ExtensionToSettingsMap,
  ExtractExtensionIds,
  ExtractExtensionSettings,
  ExtractProviderIds,
  UnionToIntersection
} from './types'

// ==================== 工具函数 ====================

// 工具函数和错误类
export { formatPrivateKey, ProviderCreationError } from './core/utils'

// ==================== 扩展功能 ====================

// Hub Provider 功能
export { createHubProvider, type HubProviderConfig, HubProviderError } from './features/HubProvider'

// ==================== Provider Extension 系统 ====================

// Extension 核心类和类型
export {
  createProviderExtension,
  type ProviderCreatorFunction,
  ProviderExtension,
  ProviderExtensionBuilder,
  type ProviderExtensionConfig,
  type ProviderModule
} from './core/ProviderExtension'

// Extension Registry
export { ExtensionRegistry, extensionRegistry } from './core/ExtensionRegistry'
export type {
  ExtensionContext,
  ExtensionHook,
  ExtensionStorage,
  LifecycleHooks,
  ProviderVariant,
  StorageAccessor
} from './types'
export type { RegisteredProviderId } from './types'
