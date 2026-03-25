/**
 * Cherry Studio AI Core Package
 * 基于 Vercel AI SDK 的统一 AI Provider 接口
 */

// 导入内部使用的类和函数

// ==================== 主要用户接口 ====================
export { createExecutor, embedMany, generateImage, generateText, streamText } from './core/runtime'

// ==================== Embedding 类型 ====================
export type { EmbedManyParams, EmbedManyResult } from './core/runtime'

// ==================== 高级API ====================
export { isV2Model, isV3Model } from './core/models'

// ==================== 插件系统 ====================
export type {
  AiPlugin,
  AiRequestContext,
  GenerateTextParams,
  GenerateTextResult,
  StreamTextParams,
  StreamTextResult
} from './core/plugins'
export { definePlugin } from './core/plugins'
export { PluginEngine } from './core/runtime/pluginEngine'

// ==================== 类型工具 ====================
export type {
  AiSdkModel,
  ExtractToolConfig,
  ExtractToolConfigMap,
  ProviderId,
  ToolCapability,
  ToolFactory,
  ToolFactoryMap,
  ToolFactoryPatch,
  WebSearchToolConfigMap
} from './core/providers'

// ==================== 错误处理 ====================
export {
  AiCoreError,
  ModelResolutionError,
  ParameterValidationError,
  PluginExecutionError,
  RecursiveDepthError,
  TemplateLoadError
} from './core/errors'
