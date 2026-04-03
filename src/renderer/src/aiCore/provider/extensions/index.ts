/**
 * Cherry Studio 项目特定的 Provider Extensions
 * 用于支持运行时动态导入的 AI Providers
 */

import { type AmazonBedrockProviderSettings, createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { type CerebrasProviderSettings, createCerebras } from '@ai-sdk/cerebras'
import { createGateway, type GatewayProviderSettings } from '@ai-sdk/gateway'
import { createVertexAnthropic, type GoogleVertexAnthropicProvider } from '@ai-sdk/google-vertex/anthropic/edge'
import { createVertex, type GoogleVertexProvider, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import { createGroq, type GroqProviderSettings } from '@ai-sdk/groq'
import { createHuggingFace, type HuggingFaceProviderSettings } from '@ai-sdk/huggingface'
import { createMistral, type MistralProviderSettings } from '@ai-sdk/mistral'
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import { createPerplexity, type PerplexityProviderSettings } from '@ai-sdk/perplexity'
import { NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import { ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import {
  createGitHubCopilotOpenAICompatible,
  type GitHubCopilotProviderSettings
} from '@opeoginni/github-copilot-openai-compatible'
import { SystemProviderIds } from '@types'
import { createPoe, type PoeProvider, type PoeProviderSettings } from 'ai-sdk-provider-poe'
import type { OllamaProviderSettings } from 'ollama-ai-provider-v2'
import { createOllama } from 'ollama-ai-provider-v2'

import { type AihubmixProviderSettings, createAihubmix } from '../custom/aihubmix-provider'
import { createNewApi, type NewApiProviderSettings } from '../custom/newapi-provider'

async function importOptionalProviderModule<TModule>(moduleName: string): Promise<TModule> {
  return (await new Function('moduleName', 'return import(moduleName)')(moduleName)) as TModule
}

function adaptPoeProvider(provider: PoeProvider): ProviderV3 {
  return {
    specificationVersion: 'v3',
    languageModel: (modelId: string) => provider.languageModel(modelId),
    embeddingModel: (modelId: string) => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'embeddingModel',
        message: `Poe provider does not support embedding model "${modelId}".`
      })
    },
    imageModel: (modelId: string) => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'imageModel',
        message: `Poe provider does not support image model "${modelId}".`
      })
    }
  }
}

/**
 * Google Vertex AI Extension
 */
export const GoogleVertexExtension = ProviderExtension.create({
  name: 'google-vertex',
  aliases: ['vertexai'] as const,
  supportsImageGeneration: true,
  create: createVertex,
  toolFactories: {
    webSearch:
      (provider: GoogleVertexProvider) =>
      (config: NonNullable<Parameters<GoogleVertexProvider['tools']['googleSearch']>[0]>) => ({
        tools: { webSearch: provider.tools.googleSearch(config) }
      }),
    urlContext:
      (provider: GoogleVertexProvider) =>
      (config: NonNullable<Parameters<GoogleVertexProvider['tools']['urlContext']>[0]>) => ({
        tools: { urlContext: provider.tools.urlContext(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<GoogleVertexProviderSettings, GoogleVertexProvider, 'google-vertex'>)

/**
 * Google Vertex AI Anthropic Extension
 */
export const GoogleVertexAnthropicExtension = ProviderExtension.create({
  name: 'google-vertex-anthropic',
  aliases: ['vertexai-anthropic'] as const,
  supportsImageGeneration: true,
  create: createVertexAnthropic,
  toolFactories: {
    webSearch:
      (provider: GoogleVertexAnthropicProvider) =>
      (config: NonNullable<Parameters<GoogleVertexAnthropicProvider['tools']['webSearch_20250305']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch_20250305(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<
  GoogleVertexProviderSettings,
  GoogleVertexAnthropicProvider,
  'google-vertex-anthropic'
>)

/**
 * GitHub Copilot Extension
 */
export const GitHubCopilotExtension = ProviderExtension.create({
  name: 'github-copilot-openai-compatible',
  aliases: ['copilot', 'github-copilot'] as const,
  supportsImageGeneration: false,
  create: (options?: GitHubCopilotProviderSettings) =>
    // GitHubCopilot并没有完整的实现ProviderV3
    createGitHubCopilotOpenAICompatible(options) as unknown as ProviderV3
} as const satisfies ProviderExtensionConfig<
  GitHubCopilotProviderSettings,
  ProviderV3,
  'github-copilot-openai-compatible'
>)

/**
 * Amazon Bedrock Extension
 */
export const BedrockExtension = ProviderExtension.create({
  name: 'bedrock',
  aliases: ['aws-bedrock'] as const,
  supportsImageGeneration: true,
  create: createAmazonBedrock
} as const satisfies ProviderExtensionConfig<AmazonBedrockProviderSettings, ProviderV3, 'bedrock'>)

/**
 * Perplexity Extension
 */
export const PerplexityExtension = ProviderExtension.create({
  name: 'perplexity',
  supportsImageGeneration: false,
  create: createPerplexity
} as const satisfies ProviderExtensionConfig<PerplexityProviderSettings, ProviderV3, 'perplexity'>)

/**
 * Poe Extension
 */
export const PoeExtension = ProviderExtension.create({
  name: 'poe',
  aliases: [SystemProviderIds.poe] as const,
  supportsImageGeneration: false,
  create: (options?: PoeProviderSettings) => adaptPoeProvider(createPoe(options)),
  toolFactories: {
    webSearch:
      () =>
      (
        config:
          | {
              downstreamProviderId: 'anthropic'
              anthropic?: NonNullable<Parameters<AnthropicProvider['tools']['webSearch_20250305']>[0]>
            }
          | {
              downstreamProviderId: 'openai'
              openai?: NonNullable<Parameters<OpenAIProvider['tools']['webSearch']>[0]>
            }
          | {
              downstreamProviderId: 'openai-chat'
              'openai-chat'?: NonNullable<Parameters<OpenAIProvider['tools']['webSearchPreview']>[0]>
            }
      ) => {
        switch (config.downstreamProviderId) {
          case 'anthropic': {
            const anthropicProvider = createAnthropic({ apiKey: '_tool_descriptor' })
            return {
              tools: {
                webSearch: anthropicProvider.tools.webSearch_20250305(config.anthropic ?? {})
              }
            }
          }
          case 'openai-chat': {
            const openAIProvider = createOpenAI({ apiKey: '_tool_descriptor' })
            return {
              tools: {
                webSearch: openAIProvider.tools.webSearchPreview(config['openai-chat'] ?? {})
              }
            }
          }
          case 'openai':
          default: {
            const openAIProvider = createOpenAI({ apiKey: '_tool_descriptor' })
            return {
              tools: {
                webSearch: openAIProvider.tools.webSearch(config.openai ?? {})
              }
            }
          }
        }
      }
  }
} as const satisfies ProviderExtensionConfig<PoeProviderSettings, ProviderV3, 'poe'>)

/**
 * Mistral Extension
 */
export const MistralExtension = ProviderExtension.create({
  name: 'mistral',
  supportsImageGeneration: false,
  create: createMistral
} as const satisfies ProviderExtensionConfig<MistralProviderSettings, ProviderV3, 'mistral'>)

/**
 * HuggingFace Extension
 */
export const HuggingFaceExtension = ProviderExtension.create({
  name: 'huggingface',
  aliases: ['hf', 'hugging-face'] as const,
  supportsImageGeneration: true,
  create: createHuggingFace
} as const satisfies ProviderExtensionConfig<HuggingFaceProviderSettings, ProviderV3, 'huggingface'>)

/**
 * Vercel AI Gateway Extension
 */
export const GatewayExtension = ProviderExtension.create({
  name: 'gateway',
  aliases: ['ai-gateway'] as const,
  supportsImageGeneration: true,
  create: createGateway
} as const satisfies ProviderExtensionConfig<GatewayProviderSettings, ProviderV3, 'gateway'>)

/**
 * Cerebras Extension
 */
export const CerebrasExtension = ProviderExtension.create({
  name: 'cerebras',
  supportsImageGeneration: false,
  create: createCerebras
} as const satisfies ProviderExtensionConfig<CerebrasProviderSettings, ProviderV3, 'cerebras'>)

/**
 * Groq Extension
 */
export const GroqExtension = ProviderExtension.create({
  name: 'groq',
  supportsImageGeneration: false,
  create: createGroq
} as const satisfies ProviderExtensionConfig<GroqProviderSettings, ProviderV3, 'groq'>)

/**
 * Ollama Extension
 */
export const OllamaExtension = ProviderExtension.create({
  name: 'ollama',
  supportsImageGeneration: false,
  create: (options?: OllamaProviderSettings) => createOllama(options)
} as const satisfies ProviderExtensionConfig<OllamaProviderSettings, ProviderV3, 'ollama'>)

/**
 * AiHubMix Extension - multi-backend gateway (claude->anthropic, gemini->google, gpt->openai-responses)
 */
export const AiHubMixExtension = ProviderExtension.create({
  name: 'aihubmix',
  supportsImageGeneration: true,
  create: createAihubmix
} as const satisfies ProviderExtensionConfig<AihubmixProviderSettings, ProviderV3, 'aihubmix'>)

/**
 * NewAPI Extension - multi-backend gateway routed by endpoint_type
 */
export const NewApiExtension = ProviderExtension.create({
  name: 'newapi',
  aliases: ['new-api'] as const,
  supportsImageGeneration: true,
  create: createNewApi
} as const satisfies ProviderExtensionConfig<NewApiProviderSettings, ProviderV3, 'newapi'>)

/**
 * Together AI Extension - chat and image generation
 */
export const TogetherAIExtension = ProviderExtension.create({
  name: 'togetherai',
  aliases: [SystemProviderIds.together] as const,
  supportsImageGeneration: true,
  create: async (options?: Record<string, unknown>) => {
    const { createTogetherAI } = await importOptionalProviderModule<{
      createTogetherAI: (options?: unknown) => ProviderV3
    }>('@ai-sdk/togetherai')
    return createTogetherAI(options as never)
  }
} as const satisfies ProviderExtensionConfig<Record<string, unknown>, ProviderV3, 'togetherai'>)

/**
 * Voyage AI Extension - embeddings and reranking
 */
export const VoyageExtension = ProviderExtension.create({
  name: 'voyage',
  aliases: [SystemProviderIds.voyageai] as const,
  supportsImageGeneration: false,
  create: async (options?: Record<string, unknown>) => {
    const { createVoyage } = await importOptionalProviderModule<{ createVoyage: (options?: unknown) => ProviderV3 }>(
      'voyage-ai-provider'
    )
    return createVoyage(options as never)
  }
} as const satisfies ProviderExtensionConfig<Record<string, unknown>, ProviderV3, 'voyage'>)

/**
 * 所有项目特定的 Extensions
 */
export const extensions = [
  GoogleVertexExtension,
  GoogleVertexAnthropicExtension,
  GitHubCopilotExtension,
  BedrockExtension,
  PerplexityExtension,
  PoeExtension,
  MistralExtension,
  HuggingFaceExtension,
  GatewayExtension,
  CerebrasExtension,
  OllamaExtension,
  AiHubMixExtension,
  NewApiExtension,
  VoyageExtension,
  TogetherAIExtension,
  GroqExtension
] as const
