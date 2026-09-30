/**
 * Provider 初始化器
 * 负责根据配置创建 providers 并注册到全局管理器
 * 使用新的 Extension 系统
 */

import type { AnthropicProvider, AnthropicProviderSettings } from '@ai-sdk/anthropic'
import type { AzureOpenAIProvider, AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import type { DeepSeekProviderSettings } from '@ai-sdk/deepseek'
import type { GoogleGenerativeAIProvider, GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import type { OpenAIProvider, OpenAIProviderSettings } from '@ai-sdk/openai'
import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import type { ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { XaiProvider, XaiProviderSettings } from '@ai-sdk/xai'
import type { OpenRouterProvider, OpenRouterProviderSettings } from '@openrouter/ai-sdk-provider'
import { customProvider, type LanguageModel } from 'ai'

import type { CherryInProvider, CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'

import type {
  ExtensionConfigToIdResolutionMap,
  ExtractExtensionIds,
  ProviderVariant,
  UnionToIntersection
} from '../types'
import { extensionRegistry } from './ExtensionRegistry'
import type { ProviderExtensionConfig } from './ProviderExtension'
import { ProviderExtension } from './ProviderExtension'

// ==================== Core Extensions ====================

function createLazyOpenAICompatibleRerankingModel(
  modelId: string,
  settings: OpenAICompatibleProviderSettings
): RerankingModelV3 {
  if (!settings.baseURL?.replace(/\/+$/, '')) {
    throw new Error('OpenAI-compatible reranking model requires baseURL')
  }

  let modelPromise: Promise<RerankingModelV3> | undefined
  return {
    specificationVersion: 'v3',
    provider: `${settings.name}.rerank`,
    modelId,
    doRerank: async (options) => {
      modelPromise ??= import('../openaiCompatible/rerankingModel').then(({ createOpenAICompatibleRerankingModel }) =>
        createOpenAICompatibleRerankingModel(modelId, settings)
      )
      return (await modelPromise).doRerank(options)
    }
  }
}

const AnthropicExtension = ProviderExtension.create({
  name: 'anthropic',
  aliases: ['claude'] as const,
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/anthropic')).createAnthropic(settings),
  toolFactories: {
    webSearch:
      (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webSearch_20260209']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch_20260209(config) }
      }),
    urlContext:
      (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webFetch_20260209']>[0]>) => ({
        tools: { urlContext: provider.tools.webFetch_20260209(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<AnthropicProviderSettings, AnthropicProvider, 'anthropic'>)

/**
 * Azure Extension
 */
const AzureExtension = ProviderExtension.create({
  name: 'azure',
  aliases: ['azure-openai'] as const,
  supportsImageGeneration: true,
  create: async (settings): Promise<ProviderV3> => {
    const provider = (await import('@ai-sdk/azure')).createAzure(settings)
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
      // AI SDK defaults to responses API, so createAzure(settings) without
      // the chat override (used in base `create`) gives us Responses API behavior.
      transform: async (_provider, settings) => (await import('@ai-sdk/azure')).createAzure(settings),
      toolFactories: {
        webSearch:
          (provider: AzureOpenAIProvider) =>
          (config: NonNullable<Parameters<AzureOpenAIProvider['tools']['webSearchPreview']>[0]>) => ({
            tools: { webSearch: provider.tools.webSearchPreview(config) }
          })
      }
    },
    // Azure 上的 Claude 模型走 Anthropic SDK
    // https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
    {
      suffix: 'anthropic',
      name: 'Azure Anthropic',
      transform: async (_provider, settings) =>
        (await import('@ai-sdk/anthropic')).createAnthropic({
          baseURL: (settings?.baseURL ?? '') + '/anthropic/v1',
          apiKey: settings?.apiKey ?? '',
          headers: settings?.headers,
          // Forward the caller-injected fetch (e.g. the proxy-aware customFetch). This
          // variant rebuilds the provider from scratch, so without this the request
          // silently falls back to the SDK default fetch and drops the wrapper.
          fetch: settings?.fetch
        }),
      toolFactories: {
        webSearch:
          (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webSearch_20260209']>[0]>) => ({
            tools: { webSearch: provider.tools.webSearch_20260209(config) }
          }),
        urlContext:
          (provider) => (config: NonNullable<Parameters<AnthropicProvider['tools']['webFetch_20260209']>[0]>) => ({
            tools: { urlContext: provider.tools.webFetch_20260209(config) }
          })
      }
    } satisfies ProviderVariant<AzureOpenAIProviderSettings, AzureOpenAIProvider, AnthropicProvider>
  ] as const
} as const satisfies ProviderExtensionConfig<AzureOpenAIProviderSettings, AzureOpenAIProvider, 'azure'>)

const CherryInExtension = ProviderExtension.create({
  name: 'cherryin',
  supportsImageGeneration: true,
  create: async (settings) => (await import('@cherrystudio/ai-sdk-provider')).createCherryIn(settings),

  variants: [
    {
      suffix: 'chat',
      name: 'CherryIN Chat',
      transform: (provider): ProviderV3 =>
        customProvider({
          fallbackProvider: {
            ...provider,
            languageModel: (modelId: string) => provider.chat(modelId)
          }
        })
    }
  ] as const
} as const satisfies ProviderExtensionConfig<CherryInProviderSettings, CherryInProvider, 'cherryin'>)

const DeepSeekExtension = ProviderExtension.create({
  name: 'deepseek',
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/deepseek')).createDeepSeek(settings)
} as const satisfies ProviderExtensionConfig<DeepSeekProviderSettings, ProviderV3, 'deepseek'>)

const GoogleExtension = ProviderExtension.create({
  name: 'google',
  aliases: ['google-ai', 'gemini', 'google-gemini'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/google')).createGoogleGenerativeAI(settings),
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
} as const satisfies ProviderExtensionConfig<GoogleGenerativeAIProviderSettings, GoogleGenerativeAIProvider, 'google'>)

const OpenAICompatibleExtension = ProviderExtension.create({
  name: 'openai-compatible',
  supportsImageGeneration: true,
  create: async (settings) => {
    if (!settings) {
      throw new Error('OpenAI Compatible provider requires settings')
    }
    const [{ createOpenAICompatible }, { applyReasoningModelMaxTokensConversion }] = await Promise.all([
      import('@ai-sdk/openai-compatible'),
      import('@cherrystudio/ai-sdk-provider')
    ])
    const { transformRequestBody } = settings
    return createOpenAICompatible({
      ...settings,
      transformRequestBody: (args) =>
        applyReasoningModelMaxTokensConversion(transformRequestBody ? transformRequestBody(args) : args)
    })
  },
  createRerankingModel: (modelId, settings) => {
    if (!settings) {
      throw new Error('OpenAI Compatible provider requires settings')
    }
    return createLazyOpenAICompatibleRerankingModel(modelId, settings)
  }
} as const satisfies ProviderExtensionConfig<OpenAICompatibleProviderSettings, ProviderV3, 'openai-compatible'>)

const OpenAIExtension = ProviderExtension.create({
  name: 'openai',
  aliases: ['openai-response'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/openai')).createOpenAI(settings),
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
      resolveModel: (provider: OpenAIProvider, modelId: string): LanguageModel => provider.chat(modelId),
      toolFactories: {
        webSearch:
          (provider: OpenAIProvider) =>
          (config: NonNullable<Parameters<OpenAIProvider['tools']['webSearchPreview']>[0]>) => ({
            tools: { webSearch: provider.tools.webSearchPreview(config) }
          })
      }
    }
  ] as const
} as const satisfies ProviderExtensionConfig<OpenAIProviderSettings, OpenAIProvider, 'openai'>)

const OpenRouterExtension = ProviderExtension.create({
  name: 'openrouter',
  supportsImageGeneration: true,
  create: async (settings) => (await import('@openrouter/ai-sdk-provider')).createOpenRouter(settings),
  toolFactories: {
    webSearch:
      (provider: OpenRouterProvider) =>
      (config: NonNullable<Parameters<OpenRouterProvider['tools']['webSearch']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch(config) }
      }),
    urlContext: (provider: OpenRouterProvider) => () => ({
      tools: { urlContext: provider.tools.webFetch({}) }
    })
  }
} as const satisfies ProviderExtensionConfig<OpenRouterProviderSettings, OpenRouterProvider, 'openrouter'>)

const XaiExtension = ProviderExtension.create({
  name: 'xai',
  aliases: ['grok'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/xai')).createXai(settings),
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
} as const satisfies ProviderExtensionConfig<XaiProviderSettings, XaiProvider, 'xai'>)

/**
 * 核心 provider extensions 列表
 */
type CoreExtensions = readonly [
  typeof OpenAIExtension,
  typeof AnthropicExtension,
  typeof AzureExtension,
  typeof GoogleExtension,
  typeof XaiExtension,
  typeof DeepSeekExtension,
  typeof OpenRouterExtension,
  typeof OpenAICompatibleExtension,
  typeof CherryInExtension
]

export const coreExtensions: CoreExtensions = [
  OpenAIExtension,
  AnthropicExtension,
  AzureExtension,
  GoogleExtension,
  XaiExtension,
  DeepSeekExtension,
  OpenRouterExtension,
  OpenAICompatibleExtension,
  CherryInExtension
]

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
    const config = ext.config as ProviderExtensionConfig<any, any, CoreProviderId>
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
