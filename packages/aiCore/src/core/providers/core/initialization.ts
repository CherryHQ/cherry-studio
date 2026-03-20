/**
 * Provider 初始化器
 * 负责根据配置创建 providers 并注册到全局管理器
 * 使用新的 Extension 系统
 */

import type { AnthropicProvider, AnthropicProviderSettings } from '@ai-sdk/anthropic'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { AzureOpenAIProvider, AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import { createAzure } from '@ai-sdk/azure'
import type { DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import { createDeepSeek } from '@ai-sdk/deepseek'
import type { GoogleGenerativeAIProvider, GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { OpenAIProvider, OpenAIProviderSettings } from '@ai-sdk/openai'
import { createOpenAI } from '@ai-sdk/openai'
import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ProviderV3 } from '@ai-sdk/provider'
import type { XaiProvider, XaiProviderSettings } from '@ai-sdk/xai'
import { createXai } from '@ai-sdk/xai'
import type { CherryInProvider, CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import { createCherryIn } from '@cherrystudio/ai-sdk-provider'
import type { OpenRouterProviderSettings } from '@openrouter/ai-sdk-provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { customProvider } from 'ai'

import { createOpenRouterOptions } from '../../options'
import type { OpenRouterSearchConfig } from '../../plugins/built-in/webSearchPlugin/openrouter'

import type {
  ExtensionConfigToIdResolutionMap,
  ExtensionStorage,
  ExtractExtensionIds,
  UnionToIntersection
} from '../types'
import { extensionRegistry } from './ExtensionRegistry'
import type { ProviderExtensionConfig } from './ProviderExtension'
import { ProviderExtension } from './ProviderExtension'

// ==================== Core Extensions ====================

const AnthropicExtension = ProviderExtension.create({
  name: 'anthropic',
  aliases: ['claude'] as const,
  supportsImageGeneration: false,
  create: createAnthropic,
  toolFactories: {
    webSearch:
      (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webSearch_20250305']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch_20250305(config) }
      }),
    urlContext:
      (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webFetch_20260209']>[0]>) => ({
        tools: { webSearch: provider.tools.webFetch_20260209(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<
  AnthropicProviderSettings,
  ExtensionStorage,
  AnthropicProvider,
  'anthropic'
>)

/**
 * Azure Extension
 */
const AzureExtension = ProviderExtension.create({
  name: 'azure',
  aliases: ['azure-openai'] as const,
  supportsImageGeneration: true,
  create: (settings) => {
    const provider = createAzure(settings)
    // Default to chat mode (AI SDK defaults to responses API)
    return customProvider({
      fallbackProvider: {
        ...provider,
        languageModel: (modelId: string) => provider.chat(modelId)
      }
    })
  },
  toolFactories: {
    webSearch:
      (provider: AzureOpenAIProvider) =>
      (config: NonNullable<Parameters<AzureOpenAIProvider['tools']['webSearchPreview']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearchPreview(config) }
      })
  },
  variants: [
    {
      suffix: 'responses',
      name: 'Azure OpenAI Responses',
      transform: (provider) =>
        customProvider({
          fallbackProvider: {
            ...provider,
            languageModel: (modelId: string) => provider.responses(modelId)
          }
        })
    },
    // Azure 上的 Claude 模型走 Anthropic SDK
    // https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
    {
      suffix: 'anthropic',
      name: 'Azure Anthropic',
      transform: (_provider, settings) =>
        createAnthropic({
          baseURL: (settings?.baseURL ?? '') + '/anthropic/v1',
          apiKey: settings?.apiKey ?? '',
          headers: settings?.headers
        })
    }
  ] as const
} as const satisfies ProviderExtensionConfig<
  AzureOpenAIProviderSettings,
  ExtensionStorage,
  AzureOpenAIProvider,
  'azure'
>)

const CherryInExtension = ProviderExtension.create({
  name: 'cherryin',
  supportsImageGeneration: true,
  create: createCherryIn,

  variants: [
    {
      suffix: 'chat',
      name: 'CherryIN Chat',
      transform: (provider) =>
        customProvider({
          fallbackProvider: {
            ...provider,
            languageModel: (modelId: string) => provider.chat(modelId)
          }
        })
    }
  ] as const
} as const satisfies ProviderExtensionConfig<CherryInProviderSettings, ExtensionStorage, CherryInProvider, 'cherryin'>)

const DeepSeekExtension = ProviderExtension.create({
  name: 'deepseek',
  supportsImageGeneration: false,
  create: createDeepSeek
} as const satisfies ProviderExtensionConfig<DeepSeekProviderSettings, ExtensionStorage, ProviderV3, 'deepseek'>)

const GoogleExtension = ProviderExtension.create({
  name: 'google',
  aliases: ['google-ai', 'gemini', 'google-gemini'] as const,
  supportsImageGeneration: true,
  create: createGoogleGenerativeAI,
  toolFactories: {
    webSearch:
      (provider: GoogleGenerativeAIProvider) =>
      (config: NonNullable<Parameters<GoogleGenerativeAIProvider['tools']['googleSearch']>[0]>) => ({
        tools: { webSearch: provider.tools.googleSearch(config) }
      }),
    urlContext: (provider) => (config) => ({
      tools: {
        urlContext: provider.tools.urlContext(config)
      }
    })
  }
} as const satisfies ProviderExtensionConfig<
  GoogleGenerativeAIProviderSettings,
  ExtensionStorage,
  GoogleGenerativeAIProvider,
  'google'
>)

const OpenAICompatibleExtension = ProviderExtension.create({
  name: 'openai-compatible',
  supportsImageGeneration: true,
  create: (settings) => {
    if (!settings) {
      throw new Error('OpenAI Compatible provider requires settings')
    }
    return createOpenAICompatible(settings)
  }
} as const satisfies ProviderExtensionConfig<
  OpenAICompatibleProviderSettings,
  ExtensionStorage,
  ProviderV3,
  'openai-compatible'
>)

const OpenAIExtension = ProviderExtension.create({
  name: 'openai',
  aliases: ['openai-response'] as const,
  supportsImageGeneration: true,
  create: createOpenAI,
  toolFactories: {
    webSearch:
      (provider: OpenAIProvider) => (config: NonNullable<Parameters<OpenAIProvider['tools']['webSearch']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch(config) }
      })
  },

  variants: [
    {
      suffix: 'chat',
      name: 'OpenAI Chat',
      resolveModel: (provider: OpenAIProvider, modelId: string) => provider.chat(modelId),
      toolFactories: {
        webSearch:
          (provider: OpenAIProvider) =>
          (config: NonNullable<Parameters<OpenAIProvider['tools']['webSearchPreview']>[0]>) => ({
            tools: { webSearch: provider.tools.webSearchPreview(config) }
          })
      }
    }
  ] as const
} as const satisfies ProviderExtensionConfig<OpenAIProviderSettings, ExtensionStorage, OpenAIProvider, 'openai'>)

const OpenRouterExtension = ProviderExtension.create({
  name: 'openrouter',
  // TODO: 实现注册后修改拓展配置
  aliases: ['tokenflux'] as const,
  supportsImageGeneration: true,
  create: createOpenRouter,
  toolFactories: {
    webSearch: () => (config: OpenRouterSearchConfig) => ({
      providerOptions: createOpenRouterOptions(config)
    })
  }
} as const satisfies ProviderExtensionConfig<OpenRouterProviderSettings, ExtensionStorage, ProviderV3, 'openrouter'>)

const XaiExtension = ProviderExtension.create({
  name: 'xai',
  aliases: ['grok'] as const,
  supportsImageGeneration: true,
  create: createXai,
  variants: [
    {
      suffix: 'responses',
      name: 'xAI Responses',
      resolveModel: (provider: XaiProvider, modelId: string) => provider.responses(modelId),
      toolFactories: {
        webSearch:
          (provider: XaiProvider) =>
          (config: {
            webSearch?: Parameters<XaiProvider['tools']['webSearch']>[0]
            xSearch?: Parameters<XaiProvider['tools']['xSearch']>[0]
          }) => ({
            tools: {
              webSearch: provider.tools.webSearch(config?.webSearch ?? {}),
              xSearch: provider.tools.xSearch(config?.xSearch ?? {})
            }
          })
      }
    }
  ] as const
} as const satisfies ProviderExtensionConfig<XaiProviderSettings, ExtensionStorage, XaiProvider, 'xai'>)

/**
 * 核心 provider extensions 列表
 */
export const coreExtensions = [
  OpenAIExtension,
  AnthropicExtension,
  AzureExtension,
  GoogleExtension,
  XaiExtension,
  DeepSeekExtension,
  OpenRouterExtension,
  OpenAICompatibleExtension,
  CherryInExtension
] as const

/**
 * 核心 Provider IDs 类型
 * 从 coreExtensions 数组自动提取所有 provider IDs（包括 aliases 和 variants）
 *
 */
export type CoreProviderId = ExtractExtensionIds<(typeof coreExtensions)[number]>

type ExtensionConfigs = (typeof coreExtensions)[number]['config']

type ProviderIdsMap = UnionToIntersection<ExtensionConfigToIdResolutionMap<ExtensionConfigs>>

export const registeredProviderIds: ProviderIdsMap = (() => {
  const map = {} as ProviderIdsMap
  coreExtensions.forEach((ext) => {
    const config = ext.config as ProviderExtensionConfig<any, any, any, CoreProviderId>
    const name = config.name
    ;(map as Record<string, CoreProviderId>)[name] = name

    if (config.aliases) {
      config.aliases.forEach((alias) => {
        ;(map as Record<string, CoreProviderId>)[alias] = name
      })
    }

    if (config.variants) {
      config.variants.forEach((variant) => {
        ;(map as Record<string, CoreProviderId>)[`${name}-${variant.suffix}`] = name
      })
    }
  })

  return map
})()

// ==================== 初始化 Extension Registry ====================

/**
 * 注册所有通用 extensions 到全局 registry
 * 在模块加载时自动执行
 *
 * 注意：只注册通用的 provider extensions（OpenAI, Anthropic, Google 等）
 * 项目特定的 extensions 应该在应用层单独注册
 */
// register() is idempotent — safe to call on HMR / re-import
extensionRegistry.registerAll(coreExtensions)

/**
 * Provider 初始化错误类型
 */
class ProviderInitializationError extends Error {
  constructor(
    message: string,
    public providerId?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderInitializationError'
  }
}

/**
 * 检查是否有对应的 Provider Extension
 */
export function hasProviderConfig(providerId: string): boolean {
  return extensionRegistry.has(providerId)
}

// ==================== 导出错误类型 ====================

export { ProviderInitializationError }
