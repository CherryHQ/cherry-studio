/**
 * Providers 模块统一导出 - 独立Provider包
 */

// ==================== 核心管理器 ====================

// Provider 核心功能
export { coreExtensions, hasProviderConfig } from './core/initialization'

// ==================== 基础数据和类型 ====================

// 类型定义
export type { AiSdkModel, ProviderError } from './types'

// 类型提取工具
export type {
  CoreProviderSettingsMap,
  ExtensionConfigToIdResolutionMap,
  ExtensionToSettingsMap,
  ExtractProviderIds,
  StringKeys,
  UnionToIntersection
} from './types'

// ==================== 工具函数 ====================

// 工具函数和错误类
export { formatPrivateKey, ProviderCreationError } from './core/utils'

// ==================== Provider Extension 系统 ====================

// Extension 核心类和类型
export {
  type ProviderCreatorFunction,
  ProviderExtension,
  type ProviderExtensionConfig,
  type ProviderModule
} from './core/ProviderExtension'

// Extension Registry
export { ExtensionRegistry, extensionRegistry } from './core/ExtensionRegistry'
export type { ProviderVariant } from './types'
export type {
  ExtractToolConfig,
  ExtractToolConfigMap,
  ProviderId,
  RegisteredProviderId,
  ToolCapability,
  ToolFactory,
  ToolFactoryMap,
  ToolFactoryPatch,
  WebSearchToolConfigMap
} from './types'
