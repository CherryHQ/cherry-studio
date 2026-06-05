/** App-specific Provider Extensions registered alongside `coreExtensions`. */

import {
  type AmazonBedrockProvider,
  type AmazonBedrockProviderSettings,
  createAmazonBedrock
} from '@ai-sdk/amazon-bedrock'
import { type CerebrasProviderSettings, createCerebras } from '@ai-sdk/cerebras'
import { createGateway, type GatewayProviderSettings } from '@ai-sdk/gateway'
import { createVertexAnthropic, type GoogleVertexAnthropicProvider } from '@ai-sdk/google-vertex/anthropic/edge'
import { createVertex, type GoogleVertexProvider, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import { createGroq, type GroqProviderSettings } from '@ai-sdk/groq'
import { createHuggingFace, type HuggingFaceProviderSettings } from '@ai-sdk/huggingface'
import { createMistral, type MistralProviderSettings } from '@ai-sdk/mistral'
import { createPerplexity, type PerplexityProviderSettings } from '@ai-sdk/perplexity'
import type { ProviderV3 } from '@ai-sdk/provider'
import { createTogetherAI, type TogetherAIProviderSettings } from '@ai-sdk/togetherai'
import { ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import {
  createGitHubCopilotOpenAICompatible,
  type GitHubCopilotProviderSettings
} from '@opeoginni/github-copilot-openai-compatible'
import { SystemProviderIds } from '@types'
import type { OllamaProviderSettings } from 'ollama-ai-provider-v2'
import { createOllama } from 'ollama-ai-provider-v2'
import { createVoyage, type VoyageProviderSettings } from 'voyage-ai-provider'

import { type AihubmixProviderSettings, createAihubmix } from '../custom/aihubmix/aihubmixProvider'
import { createDashScopeProvider, type DashScopeProviderSettings } from '../custom/dashscope/dashscopeProvider'
import { createDmxapiProvider, type DmxapiProviderSettings } from '../custom/dmxapi/dmxapiProvider'
import { createModelscopeProvider, type ModelscopeProviderSettings } from '../custom/modelscope/modelscopeProvider'
import { createNewApi, type NewApiProviderSettings } from '../custom/newapiProvider'
import { createOvmsProvider, type OvmsProviderSettings } from '../custom/ovms/ovmsProvider'
import { createPpioProvider, type PpioProviderSettings } from '../custom/ppio/ppioProvider'
import { createSiliconProvider, type SiliconProviderSettings } from '../custom/silicon/siliconProvider'
import { createZhipuProvider, type ZhipuProviderSettings } from '../custom/zhipuProvider'

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

export const GitHubCopilotExtension = ProviderExtension.create({
  name: 'github-copilot-openai-compatible',
  aliases: ['copilot', 'github-copilot'] as const,
  supportsImageGeneration: false,
  // Cast because the upstream package doesn't fully implement `ProviderV3`.
  create: (options?: GitHubCopilotProviderSettings) =>
    createGitHubCopilotOpenAICompatible(options) as unknown as ProviderV3
} as const satisfies ProviderExtensionConfig<
  GitHubCopilotProviderSettings,
  ProviderV3,
  'github-copilot-openai-compatible'
>)

export const BedrockExtension = ProviderExtension.create({
  name: 'bedrock',
  aliases: ['aws-bedrock'] as const,
  supportsImageGeneration: true,
  create: createAmazonBedrock,
  // Bedrock runs Anthropic models, whose `tools` expose the same server-side
  // web-search / web-fetch factories as the native `anthropic` extension.
  toolFactories: {
    webSearch:
      (provider: AmazonBedrockProvider) =>
      (config: NonNullable<Parameters<AmazonBedrockProvider['tools']['webSearch_20260209']>[0]>) => ({
        tools: { webSearch: provider.tools.webSearch_20260209(config) }
      }),
    urlContext:
      (provider: AmazonBedrockProvider) =>
      (config: NonNullable<Parameters<AmazonBedrockProvider['tools']['webFetch_20260209']>[0]>) => ({
        tools: { urlContext: provider.tools.webFetch_20260209(config) }
      })
  }
} as const satisfies ProviderExtensionConfig<AmazonBedrockProviderSettings, AmazonBedrockProvider, 'bedrock'>)

export const PerplexityExtension = ProviderExtension.create({
  name: 'perplexity',
  supportsImageGeneration: false,
  create: createPerplexity
} as const satisfies ProviderExtensionConfig<PerplexityProviderSettings, ProviderV3, 'perplexity'>)

export const MistralExtension = ProviderExtension.create({
  name: 'mistral',
  supportsImageGeneration: false,
  create: createMistral
} as const satisfies ProviderExtensionConfig<MistralProviderSettings, ProviderV3, 'mistral'>)

export const HuggingFaceExtension = ProviderExtension.create({
  name: 'huggingface',
  aliases: ['hf', 'hugging-face'] as const,
  supportsImageGeneration: true,
  create: createHuggingFace
} as const satisfies ProviderExtensionConfig<HuggingFaceProviderSettings, ProviderV3, 'huggingface'>)

export const GatewayExtension = ProviderExtension.create({
  name: 'gateway',
  aliases: ['ai-gateway'] as const,
  supportsImageGeneration: true,
  create: createGateway
} as const satisfies ProviderExtensionConfig<GatewayProviderSettings, ProviderV3, 'gateway'>)

export const CerebrasExtension = ProviderExtension.create({
  name: 'cerebras',
  supportsImageGeneration: false,
  create: createCerebras
} as const satisfies ProviderExtensionConfig<CerebrasProviderSettings, ProviderV3, 'cerebras'>)

export const GroqExtension = ProviderExtension.create({
  name: 'groq',
  supportsImageGeneration: false,
  create: createGroq
} as const satisfies ProviderExtensionConfig<GroqProviderSettings, ProviderV3, 'groq'>)

export const OllamaExtension = ProviderExtension.create({
  name: 'ollama',
  supportsImageGeneration: false,
  create: (options?: OllamaProviderSettings) => createOllama(options)
} as const satisfies ProviderExtensionConfig<OllamaProviderSettings, ProviderV3, 'ollama'>)

/** AiHubMix — multi-backend gateway (claude→anthropic, gemini→google, gpt→openai-responses). */
export const AiHubMixExtension = ProviderExtension.create({
  name: 'aihubmix',
  supportsImageGeneration: true,
  create: createAihubmix
} as const satisfies ProviderExtensionConfig<AihubmixProviderSettings, ProviderV3, 'aihubmix'>)

/** NewAPI — multi-backend gateway routed by endpoint_type. */
export const NewApiExtension = ProviderExtension.create({
  name: 'newapi',
  aliases: ['new-api', 'o3'] as const,
  supportsImageGeneration: true,
  create: createNewApi
} as const satisfies ProviderExtensionConfig<NewApiProviderSettings, ProviderV3, 'newapi'>)

export const TogetherAIExtension = ProviderExtension.create({
  name: 'togetherai',
  aliases: [SystemProviderIds.together] as const,
  supportsImageGeneration: true,
  create: createTogetherAI
} as const satisfies ProviderExtensionConfig<TogetherAIProviderSettings, ProviderV3, 'togetherai'>)

/**
 * PPIO Extension - unified chat + embedding + image (async submit/poll for painting)
 */
export const PpioExtension = ProviderExtension.create({
  name: 'ppio',
  supportsImageGeneration: true,
  create: createPpioProvider
} as const satisfies ProviderExtensionConfig<PpioProviderSettings, ProviderV3, 'ppio'>)

/**
 * DMXAPI Extension - unified chat + embedding + image (single-shot for painting)
 */
export const DmxapiExtension = ProviderExtension.create({
  name: 'dmxapi',
  supportsImageGeneration: true,
  create: createDmxapiProvider
} as const satisfies ProviderExtensionConfig<DmxapiProviderSettings, ProviderV3, 'dmxapi'>)

/**
 * SiliconFlow Extension - OpenAI-compatible chat + embedding, URL-returning sync image generation.
 */
export const SiliconExtension = ProviderExtension.create({
  name: 'silicon',
  supportsImageGeneration: true,
  create: createSiliconProvider
} as const satisfies ProviderExtensionConfig<SiliconProviderSettings, ProviderV3, 'silicon'>)

/**
 * Zhipu Extension - OpenAI-compatible chat + embedding, URL-returning sync image generation.
 */
export const ZhipuExtension = ProviderExtension.create({
  name: 'zhipu',
  supportsImageGeneration: true,
  create: createZhipuProvider
} as const satisfies ProviderExtensionConfig<ZhipuProviderSettings, ProviderV3, 'zhipu'>)

/**
 * OVMS Extension - unified chat + embedding + image (local OpenVINO Model Server, no auth)
 */
export const OvmsExtension = ProviderExtension.create({
  name: 'ovms',
  supportsImageGeneration: true,
  create: createOvmsProvider
} as const satisfies ProviderExtensionConfig<OvmsProviderSettings, ProviderV3, 'ovms'>)

/**
 * ModelScope Extension - OpenAI-compatible chat + embedding, async submit/poll image
 * generation via `X-ModelScope-Async-Mode`.
 */
export const ModelscopeExtension = ProviderExtension.create({
  name: 'modelscope',
  supportsImageGeneration: true,
  create: createModelscopeProvider
} as const satisfies ProviderExtensionConfig<ModelscopeProviderSettings, ProviderV3, 'modelscope'>)

/**
 * DashScope (Bailian) Extension - OpenAI-compatible chat + embedding,
 * native DashScope async submit/poll image generation against
 * `/api/v1/services/aigc/*`. Image baseURL is derived per-call from the
 * user's chat baseURL by `buildDashScopeConfig`, so cn/intl/proxy hosts
 * track the user's provider config without hardcoded region URLs.
 */
export const DashScopeExtension = ProviderExtension.create({
  name: 'dashscope',
  aliases: ['bailian'] as const,
  supportsImageGeneration: true,
  create: createDashScopeProvider
} as const satisfies ProviderExtensionConfig<DashScopeProviderSettings, ProviderV3, 'dashscope'>)

/**
 * Voyage AI Extension - embeddings and reranking
 */
export const VoyageExtension = ProviderExtension.create({
  name: 'voyage',
  aliases: [SystemProviderIds.voyageai] as const,
  supportsImageGeneration: false,
  create: createVoyage
} as const satisfies ProviderExtensionConfig<VoyageProviderSettings, ProviderV3, 'voyage'>)

export const extensions = [
  GoogleVertexExtension,
  GoogleVertexAnthropicExtension,
  GitHubCopilotExtension,
  BedrockExtension,
  PerplexityExtension,
  MistralExtension,
  HuggingFaceExtension,
  GatewayExtension,
  CerebrasExtension,
  OllamaExtension,
  AiHubMixExtension,
  NewApiExtension,
  PpioExtension,
  DmxapiExtension,
  SiliconExtension,
  ZhipuExtension,
  OvmsExtension,
  ModelscopeExtension,
  DashScopeExtension,
  VoyageExtension,
  TogetherAIExtension,
  GroqExtension
] as const
