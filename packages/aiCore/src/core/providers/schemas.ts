/**
 * Provider Config 定义
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { type AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { LanguageModelV2 } from '@ai-sdk/provider'
import { createXai } from '@ai-sdk/xai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { customProvider, Provider } from 'ai'
import { z } from 'zod'

/**
 * 基础 Provider IDs
 */
export const baseProviderIds = [
  'openai',
  'openai-chat',
  'openai-compatible',
  'anthropic',
  'google',
  'xai',
  'azure',
  'azure-responses',
  'deepseek',
  'openrouter'
] as const

/**
 * 基础 Provider ID Schema
 */
export const baseProviderIdSchema = z.enum(baseProviderIds)

/**
 * 基础 Provider ID
 */
export type BaseProviderId = z.infer<typeof baseProviderIdSchema>

export const isBaseProvider = (id: ProviderId): id is BaseProviderId => {
  return baseProviderIdSchema.safeParse(id).success
}

type BaseProvider = {
  id: BaseProviderId
  name: string
  creator: (options: any) => Provider | LanguageModelV2
  supportsImageGeneration: boolean
}

/**
 * 基础 Providers 定义
 * 作为唯一数据源，避免重复维护
 */
export const baseProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    creator: createOpenAI,
    supportsImageGeneration: true
  },
  {
    id: 'openai-chat',
    name: 'OpenAI Chat',
    creator: (options: OpenAIProviderSettings) => {
      const provider = createOpenAI(options)
      return customProvider({
        fallbackProvider: {
          ...provider,
          languageModel: (modelId: string) => provider.chat(modelId)
        }
      })
    },
    supportsImageGeneration: true
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    creator: createOpenAICompatible,
    supportsImageGeneration: true
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    creator: createAnthropic,
    supportsImageGeneration: false
  },
  {
    id: 'google',
    name: 'Google Generative AI',
    creator: createGoogleGenerativeAI,
    supportsImageGeneration: true
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    creator: createXai,
    supportsImageGeneration: true
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    creator: createAzure,
    supportsImageGeneration: true
  },
  {
    id: 'azure-responses',
    name: 'Azure OpenAI Responses',
    creator: (options: AzureOpenAIProviderSettings) => {
      const provider = createAzure(options)
      return customProvider({
        fallbackProvider: {
          ...provider,
          languageModel: (modelId: string) => provider.responses(modelId)
        }
      })
    },
    supportsImageGeneration: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    creator: createDeepSeek,
    supportsImageGeneration: false
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    creator: createOpenRouter,
    supportsImageGeneration: true
  }
] as const satisfies BaseProvider[]

/**
 * 用户自定义 Provider ID Schema
 * 允许任意字符串，但排除基础 provider IDs 以避免冲突
 */
export const customProviderIdSchema = z
  .string()
  .min(1)
  .refine((id) => !baseProviderIds.includes(id as any), {
    message: 'Custom provider ID cannot conflict with base provider IDs'
  })

/**
 * Provider ID Schema - 支持基础和自定义
 */
export const providerIdSchema = z.union([baseProviderIdSchema, customProviderIdSchema])

/**
 * Provider 配置 Schema
 * 用于Provider的配置验证
 */
export const providerConfigSchema = z
  .object({
    id: customProviderIdSchema, // 只允许自定义ID
    name: z.string().min(1),
    creator: z
      .function({
        input: z.any(),
        output: z.any()
      })
      .optional(),
    import: z.function().optional(),
    creatorFunctionName: z.string().optional(),
    supportsImageGeneration: z.boolean().default(false),
    imageCreator: z.function().optional(),
    validateOptions: z.function().optional(),
    aliases: z.array(z.string()).optional()
  })
  .refine((data) => data.creator || (data.import && data.creatorFunctionName), {
    message: 'Must provide either creator function or import configuration'
  })

/**
 * Provider ID 类型 - 基于 zod schema 推导
 */
export type ProviderId = z.infer<typeof providerIdSchema>
export type CustomProviderId = z.infer<typeof customProviderIdSchema>

/**
 * Provider 配置类型
 */
export type ProviderConfig = z.infer<typeof providerConfigSchema>

/**
 * 兼容性类型别名
 * @deprecated 使用 ProviderConfig 替代
 */
export type DynamicProviderRegistration = ProviderConfig
