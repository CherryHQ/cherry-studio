/**
 * Cherry Studio AI Core Package
 * 基于 Vercel AI SDK 的统一 AI Provider 接口
 */

// 导入内部使用的类和函数
import {
  getProviderInfo as factoryGetProviderInfo,
  getSupportedProviders as factoryGetSupportedProviders
} from './core/models'
import { aiProviderRegistry, isProviderSupported } from './core/providers/registry'
import type { ProviderId } from './core/providers/types'
import type { ProviderSettingsMap } from './core/providers/types'
import { createExecutor } from './core/runtime'

// ==================== 主要用户接口 ====================
export {
  createExecutor,
  createOpenAICompatibleExecutor,
  generateImage,
  generateObject,
  generateText,
  streamText
} from './core/runtime'

// ==================== 高级API ====================
export { createModel } from './core/models'

// ==================== 插件系统 ====================
export type { AiPlugin, AiRequestContext, HookResult, PluginManagerConfig } from './core/plugins'
export { createContext, definePlugin, PluginManager } from './core/plugins'
// export { createPromptToolUsePlugin, webSearchPlugin } from './core/plugins/built-in'
export { PluginEngine } from './core/runtime/pluginEngine'

// ==================== 低级 API ====================
export {
  createBaseModel as createApiClient,
  createImageModel,
  getProviderInfo as getClientInfo,
  getSupportedProviders,
  ModelCreationError
} from './core/models'
export { aiProviderRegistry } from './core/providers/registry'

// ==================== 类型定义 ====================
export type { ProviderConfig } from './core/providers/types'
export type { ProviderError } from './core/providers/types'
export type {
  AnthropicProviderSettings,
  AzureOpenAIProviderSettings,
  DeepSeekProviderSettings,
  GenerateObjectParams,
  GenerateTextParams,
  GoogleGenerativeAIProviderSettings,
  OpenAICompatibleProviderSettings,
  OpenAIProviderSettings,
  ProviderId,
  ProviderSettings,
  ProviderSettingsMap,
  StreamObjectParams,
  StreamTextParams,
  XaiProviderSettings
} from './types'
export * as aiSdk from 'ai'

// ==================== AI SDK 常用类型导出 ====================
// 直接导出 AI SDK 的常用类型，方便使用
export type { LanguageModelV2Middleware, LanguageModelV2StreamPart } from '@ai-sdk/provider'
export type { ToolCall } from '@ai-sdk/provider-utils'
export type { ReasoningPart } from '@ai-sdk/provider-utils'
export type {
  AssistantModelMessage,
  FilePart,
  // 通用类型
  FinishReason,
  GenerateObjectResult,
  // 生成相关类型
  GenerateTextResult,
  ImagePart,
  InvalidToolInputError,
  LanguageModelUsage, // AI SDK 4.0 中 TokenUsage 改名为 LanguageModelUsage
  // 消息相关类型
  ModelMessage,
  // 错误类型
  NoSuchToolError,
  StreamTextResult,
  SystemModelMessage,
  TextPart,
  // 流相关类型
  TextStreamPart,
  // 工具相关类型
  Tool,
  ToolCallPart,
  ToolModelMessage,
  ToolResultPart,
  ToolSet,
  TypedToolCall,
  TypedToolResult,
  UserModelMessage
} from 'ai'
export {
  defaultSettingsMiddleware,
  extractReasoningMiddleware,
  simulateStreamingMiddleware,
  smoothStream,
  stepCountIs
} from 'ai'
// 重新导出 Agent
export { Experimental_Agent as Agent } from 'ai'

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

// ==================== 工具函数 ====================
export {
  getAllDynamicMappings,
  getAllProviders,
  getDynamicProviders,
  getProvider,
  getProviderMapping,
  isDynamicProvider,
  isProviderSupported,
  // 动态注册功能
  registerDynamicProvider,
  registerMultipleProviders,
  registerProvider
} from './core/providers/registry'

// ==================== Provider 配置工厂 ====================
export {
  type BaseProviderConfig,
  createProviderConfig,
  type ProviderConfigBuilder,
  providerConfigBuilder,
  ProviderConfigFactory
} from './core/providers/factory'

// ==================== 包信息 ====================
export const AI_CORE_VERSION = '1.0.0'
export const AI_CORE_NAME = '@cherrystudio/ai-core'

// ==================== 便捷 API ====================
// 主要的便捷工厂类
export const AiCore = {
  version: AI_CORE_VERSION,
  name: AI_CORE_NAME,

  // 创建主要执行器（推荐使用）
  create(providerId: ProviderId, options: ProviderSettingsMap[ProviderId], plugins: any[] = []) {
    return createExecutor(providerId, options, plugins)
  },

  // 获取支持的providers
  getSupportedProviders() {
    return factoryGetSupportedProviders()
  },

  // 检查provider支持
  isSupported(providerId: string) {
    return isProviderSupported(providerId)
  },

  // 获取客户端信息
  getClientInfo(providerId: string) {
    return factoryGetProviderInfo(providerId)
  }
}

// 推荐使用的执行器创建函数
export const createOpenAIExecutor = (options: ProviderSettingsMap['openai'], plugins?: any[]) => {
  return createExecutor('openai', options, plugins)
}

export const createAnthropicExecutor = (options: ProviderSettingsMap['anthropic'], plugins?: any[]) => {
  return createExecutor('anthropic', options, plugins)
}

export const createGoogleExecutor = (options: ProviderSettingsMap['google'], plugins?: any[]) => {
  return createExecutor('google', options, plugins)
}

export const createXAIExecutor = (options: ProviderSettingsMap['xai'], plugins?: any[]) => {
  return createExecutor('xai', options, plugins)
}

// ==================== 调试和开发工具 ====================
export const DevTools = {
  // 列出所有注册的providers
  listProviders() {
    return aiProviderRegistry.getAllProviders().map((p) => ({
      id: p.id,
      name: p.name
    }))
  },

  // 测试provider连接
  async testProvider(providerId: ProviderId, options: ProviderSettingsMap[ProviderId]) {
    try {
      const executor = createExecutor(providerId, options)
      const info = executor.getClientInfo()
      return {
        success: true,
        providerId: info.id,
        name: info.name,
        isSupported: info.isSupported
      }
    } catch (error) {
      return {
        success: false,
        providerId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  },

  // 获取provider详细信息
  getProviderDetails() {
    const providers = aiProviderRegistry.getAllProviders()

    return {
      supportedProviders: providers.length,
      registeredProviders: providers.length,
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name
      }))
    }
  }
}
