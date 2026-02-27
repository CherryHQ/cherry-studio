/**
 * Cherry Studio AI Core Package
 * 基于 Vercel AI SDK 的统一 AI Provider 接口
 */

// 导入内部使用的类和函数

// ==================== 主要用户接口 ====================
export {
  createExecutor,
  createOpenAICompatibleExecutor,
  generateImage,
  generateText,
  streamText
} from './core/runtime'

// ==================== 高级API ====================
export { isV2Model, isV3Model, globalModelResolver as modelResolver } from './core/models'

// ==================== 插件系统 ====================
export type {
  AiPlugin,
  AiRequestContext,
  AiRequestMetadata,
  GenerateTextParams,
  GenerateTextResult,
  HookResult,
  PluginManagerConfig,
  RecursiveCallFn,
  StreamTextParams,
  StreamTextResult
} from './core/plugins'
export { createContext, definePlugin, PluginManager } from './core/plugins'
export { PluginEngine } from './core/runtime/pluginEngine'

// ==================== 类型工具 ====================
export type { AiSdkModel } from './core/providers'

// ==================== 选项 ====================
export {
  createAnthropicOptions,
  createGoogleOptions,
  createOpenAIOptions,
  type ExtractProviderOptions,
  mergeProviderOptions,
  type ProviderOptionsMap,
  type TypedProviderOptions
} from './core/options'

// ==================== 错误处理 ====================
export {
  AiCoreError,
  ModelResolutionError,
  ParameterValidationError,
  PluginExecutionError,
  ProviderConfigError,
  RecursiveDepthError,
  TemplateLoadError
} from './core/errors'

// ==================== 包信息 ====================
export const AI_CORE_VERSION = '1.0.0'
export const AI_CORE_NAME = '@cherrystudio/ai-core'
