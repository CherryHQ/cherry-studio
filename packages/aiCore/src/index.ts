/**
 * Cherry Studio AI Core Package
 * 基于 Vercel AI SDK 的统一 AI Provider 接口
 */

// 导入内部使用的类和函数
import { ApiClientFactory } from './clients/ApiClientFactory'
import { createClient } from './clients/PluginEnabledAiClient'
import { type ProviderSettingsMap } from './clients/types'
import { createUniversalClient } from './clients/UniversalAiSdkClient'
import { aiProviderRegistry, isProviderSupported } from './providers/registry'

// ==================== 主要客户端接口 ====================
// 默认使用集成插件系统的客户端
export {
  PluginEnabledAiClient as AiClient,
  createClient,
  createCompatibleClient
} from './clients/PluginEnabledAiClient'

// 为了向后兼容，也导出原名称
export { PluginEnabledAiClient } from './clients/PluginEnabledAiClient'

// ==================== 插件系统 ====================
export type { AiPlugin, AiRequestContext, HookResult, HookType, PluginManagerConfig } from './plugins'
export { createContext, definePlugin, PluginManager } from './plugins'

// ==================== 底层客户端（高级用法） ====================
// 不带插件系统的基础客户端，用于需要绕过插件系统的场景
export {
  createOpenAICompatibleClient as createBasicOpenAICompatibleClient,
  createUniversalClient,
  UniversalAiSdkClient
} from './clients/UniversalAiSdkClient'

// ==================== 低级 API ====================
export { ApiClientFactory } from './clients/ApiClientFactory'
export { aiProviderRegistry } from './providers/registry'

// ==================== 类型定义 ====================
export type { ClientFactoryError } from './clients/ApiClientFactory'
export type {
  GenerateObjectParams,
  GenerateTextParams,
  ProviderSettings,
  StreamObjectParams,
  StreamTextParams
} from './clients/types'
export type { ProviderConfig } from './providers/registry'
export type { ProviderError } from './providers/types'
export * as aiSdk from 'ai'

// ==================== AI SDK 常用类型导出 ====================
// 直接导出 AI SDK 的常用类型，方便使用
export type {
  CoreAssistantMessage,
  // 消息相关类型
  CoreMessage,
  CoreSystemMessage,
  CoreToolMessage,
  CoreUserMessage,
  // 通用类型
  FinishReason,
  GenerateObjectResult,
  // 生成相关类型
  GenerateTextResult,
  InvalidToolArgumentsError,
  LanguageModelUsage, // AI SDK 4.0 中 TokenUsage 改名为 LanguageModelUsage
  LanguageModelV1Middleware,
  LanguageModelV1StreamPart,
  // 错误类型
  NoSuchToolError,
  StreamTextResult,
  // 流相关类型
  TextStreamPart,
  // 工具相关类型
  Tool,
  ToolCall,
  ToolExecutionError,
  ToolResult
} from 'ai'
export { defaultSettingsMiddleware, extractReasoningMiddleware, simulateStreamingMiddleware, smoothStream } from 'ai'

// 重新导出所有 Provider Settings 类型
export type {
  AmazonBedrockProviderSettings,
  AnthropicProviderSettings,
  AnthropicVertexProviderSettings,
  AzureOpenAIProviderSettings,
  CerebrasProviderSettings,
  CohereProviderSettings,
  DeepInfraProviderSettings,
  DeepSeekProviderSettings,
  FalProviderSettings,
  FireworksProviderSettings,
  GoogleGenerativeAIProviderSettings,
  GoogleVertexProviderSettings,
  GroqProviderSettings,
  MistralProviderSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
  OpenAIProviderSettings,
  OpenRouterProviderSettings,
  PerplexityProviderSettings,
  ProviderId,
  ProviderSettingsMap,
  QwenProviderSettings,
  ReplicateProviderSettings,
  TogetherAIProviderSettings,
  VercelProviderSettings,
  XaiProviderSettings,
  ZhipuProviderSettings
} from './clients/types'

// ==================== 选项 ====================
export {
  createAnthropicOptions,
  createGoogleOptions,
  createOpenAIOptions,
  type ExtractProviderOptions,
  mergeProviderOptions,
  type ProviderOptionsMap,
  type TypedProviderOptions
} from './options'

// ==================== 工具函数 ====================
export { createClient as createApiClient, getClientInfo, getSupportedProviders } from './clients/ApiClientFactory'
export { getAllProviders, getProvider, isProviderSupported, registerProvider } from './providers/registry'

// ==================== Provider 配置工厂 ====================
export {
  type BaseProviderConfig,
  createProviderConfig,
  type ProviderConfigBuilder,
  providerConfigBuilder,
  ProviderConfigFactory
} from './providers/factory'

// ==================== 包信息 ====================
export const AI_CORE_VERSION = '1.0.0'
export const AI_CORE_NAME = '@cherrystudio/ai-core'

// ==================== 便捷 API ====================
// 主要的便捷工厂类
export const AiCore = {
  version: AI_CORE_VERSION,
  name: AI_CORE_NAME,

  // 创建主要客户端（默认带插件系统）
  create(providerId: string, options: any = {}, plugins: any[] = []) {
    return createClient(providerId, options, plugins)
  },

  // 创建基础客户端（不带插件系统）
  createBasic(providerId: string, options: any = {}) {
    return createUniversalClient(providerId, options)
  },

  // 获取支持的providers
  getSupportedProviders() {
    return ApiClientFactory.getSupportedProviders()
  },

  // 检查provider支持
  isSupported(providerId: string) {
    return isProviderSupported(providerId)
  },

  // 获取客户端信息
  getClientInfo(providerId: string) {
    return ApiClientFactory.getClientInfo(providerId)
  }
}

export const createOpenAIClient = (options: ProviderSettingsMap['openai'], plugins?: any[]) => {
  return createClient('openai', options, plugins)
}

export const createAnthropicClient = (options: ProviderSettingsMap['anthropic'], plugins?: any[]) => {
  return createClient('anthropic', options, plugins)
}

export const createGoogleClient = (options: ProviderSettingsMap['google'], plugins?: any[]) => {
  return createClient('google', options, plugins)
}

export const createXAIClient = (options: ProviderSettingsMap['xai'], plugins?: any[]) => {
  return createClient('xai', options, plugins)
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
  async testProvider(providerId: string, options: any) {
    try {
      const client = createClient(providerId, options)
      const info = client.getClientInfo()
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
