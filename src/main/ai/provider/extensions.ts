/** App-specific Provider Extensions registered alongside `coreExtensions`. */

import type { AmazonBedrockProvider, AmazonBedrockProviderSettings } from '@ai-sdk/amazon-bedrock'
import type { ByteDanceProviderSettings } from '@ai-sdk/bytedance'
import type { CerebrasProviderSettings } from '@ai-sdk/cerebras'
import type { GatewayProviderSettings } from '@ai-sdk/gateway'
import type { GoogleVertexAnthropicProvider } from '@ai-sdk/google-vertex/anthropic/edge'
import type { GoogleVertexProvider, GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import type { GoogleVertexMaasProvider, GoogleVertexMaasProviderSettings } from '@ai-sdk/google-vertex/maas/edge'
import type { GroqProviderSettings } from '@ai-sdk/groq'
import type { HuggingFaceProviderSettings } from '@ai-sdk/huggingface'
import type { MistralProviderSettings } from '@ai-sdk/mistral'
import type { PerplexityProviderSettings } from '@ai-sdk/perplexity'
import type { ProviderV3 } from '@ai-sdk/provider'
import type { TogetherAIProviderSettings } from '@ai-sdk/togetherai'
import { ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import type { GitHubCopilotProviderSettings } from '@opeoginni/github-copilot-openai-compatible'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { OllamaProviderSettings } from 'ollama-ai-provider-v2'
import type { VoyageProviderSettings } from 'voyage-ai-provider'

import type { AihubmixProviderSettings } from './custom/aihubmix/aihubmixProvider'
import type { DashScopeProviderSettings } from './custom/dashscope/dashscopeProvider'
import type { DmxapiProviderSettings } from './custom/dmxapi/dmxapiProvider'
import type { LocalEmbeddingProviderSettings } from './custom/localEmbedding/localEmbeddingProvider'
import type { MinimaxProviderSettings } from './custom/minimax/minimaxProvider'
import type { ModelscopeProviderSettings } from './custom/modelscope/modelscopeProvider'
import type {
  createKimiWebSearchToolFor,
  KIMI_WEB_SEARCH_TOOL_NAME,
  KimiFormulaCredentials,
  MoonshotProvider,
  MoonshotProviderSettings
} from './custom/moonshotProvider'
import type { NewApiProviderSettings } from './custom/newapiProvider'
import type { OvmsProviderSettings } from './custom/ovms/ovmsProvider'
import type { PpioProviderSettings } from './custom/ppio/ppioProvider'
import type { SiliconProviderSettings } from './custom/silicon/siliconProvider'
import type { ZhipuProviderSettings } from './custom/zhipuProvider'

let moonshotWebSearchToolFactory: typeof createKimiWebSearchToolFor | undefined
let moonshotWebSearchToolName: typeof KIMI_WEB_SEARCH_TOOL_NAME | undefined

export const GoogleVertexExtension = ProviderExtension.create({
  name: 'google-vertex',
  aliases: ['vertexai'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/google-vertex/edge')).createVertex(settings),
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
  create: async (settings) => (await import('@ai-sdk/google-vertex/anthropic/edge')).createVertexAnthropic(settings),
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
 * Vertex MaaS — open/partner models (Llama, DeepSeek, Qwen, GLM, Kimi, gpt-oss)
 * served over Vertex's OpenAI-compatible Chat Completions endpoint. Distinct from
 * `google-vertex` (Gemini generateContent) and `google-vertex-anthropic` (Claude
 * messages); the adapter mints the GCP bearer token itself from the same iam-gcp
 * service-account credentials.
 */
export const GoogleVertexMaaSExtension = ProviderExtension.create({
  name: 'google-vertex-maas',
  aliases: ['vertexai-maas'] as const,
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/google-vertex/maas/edge')).createVertexMaas(settings)
} as const satisfies ProviderExtensionConfig<
  GoogleVertexMaasProviderSettings,
  GoogleVertexMaasProvider,
  'google-vertex-maas'
>)

export const GitHubCopilotExtension = ProviderExtension.create({
  name: 'github-copilot-openai-compatible',
  aliases: ['copilot', 'github-copilot'] as const,
  supportsImageGeneration: false,
  // Cast because the upstream package doesn't fully implement `ProviderV3`.
  create: async (options?: GitHubCopilotProviderSettings) =>
    (await import('@opeoginni/github-copilot-openai-compatible')).createGitHubCopilotOpenAICompatible(
      options
    ) as unknown as ProviderV3
} as const satisfies ProviderExtensionConfig<
  GitHubCopilotProviderSettings,
  ProviderV3,
  'github-copilot-openai-compatible'
>)

export const BedrockExtension = ProviderExtension.create({
  name: 'bedrock',
  aliases: ['aws-bedrock'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/amazon-bedrock')).createAmazonBedrock(settings),
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
  create: async (settings) => (await import('@ai-sdk/perplexity')).createPerplexity(settings)
} as const satisfies ProviderExtensionConfig<PerplexityProviderSettings, ProviderV3, 'perplexity'>)

export const MistralExtension = ProviderExtension.create({
  name: 'mistral',
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/mistral')).createMistral(settings)
} as const satisfies ProviderExtensionConfig<MistralProviderSettings, ProviderV3, 'mistral'>)

export const HuggingFaceExtension = ProviderExtension.create({
  name: 'huggingface',
  aliases: ['hf', 'hugging-face'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/huggingface')).createHuggingFace(settings)
} as const satisfies ProviderExtensionConfig<HuggingFaceProviderSettings, ProviderV3, 'huggingface'>)

export const GatewayExtension = ProviderExtension.create({
  name: 'gateway',
  aliases: ['ai-gateway'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/gateway/gatewayProvider')).createGatewayWithImageModel(settings)
} as const satisfies ProviderExtensionConfig<GatewayProviderSettings, ProviderV3, 'gateway'>)

export const CerebrasExtension = ProviderExtension.create({
  name: 'cerebras',
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/cerebras')).createCerebras(settings)
} as const satisfies ProviderExtensionConfig<CerebrasProviderSettings, ProviderV3, 'cerebras'>)

export const GroqExtension = ProviderExtension.create({
  name: 'groq',
  supportsImageGeneration: false,
  create: async (settings) => (await import('@ai-sdk/groq')).createGroq(settings)
} as const satisfies ProviderExtensionConfig<GroqProviderSettings, ProviderV3, 'groq'>)

export const OllamaExtension = ProviderExtension.create({
  name: 'ollama',
  supportsImageGeneration: true,
  create: async (options?: OllamaProviderSettings) =>
    (await import('./custom/ollama/ollamaProvider')).createOllamaWithImageModel(options)
} as const satisfies ProviderExtensionConfig<OllamaProviderSettings, ProviderV3, 'ollama'>)

export const MinimaxExtension = ProviderExtension.create({
  name: 'minimax',
  aliases: ['minimax-global'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/minimax/minimaxProvider')).createMinimaxProvider(settings)
} as const satisfies ProviderExtensionConfig<MinimaxProviderSettings, ProviderV3, 'minimax'>)

/**
 * Moonshot (Kimi) — OpenAI-compatible chat. Built-in search rides Kimi's official *formula* channel:
 * a normal function tool whose `execute` POSTs the model's arguments to the formula's fiber endpoint
 * and returns the fiber output (see moonshotProvider.ts). One path for both the K2 and K3 lines.
 */
export const MoonshotExtension = ProviderExtension.create({
  name: 'moonshot',
  supportsImageGeneration: false,
  create: async (settings) => {
    const module = await import('./custom/moonshotProvider')
    moonshotWebSearchToolFactory = module.createKimiWebSearchToolFor
    moonshotWebSearchToolName = module.KIMI_WEB_SEARCH_TOOL_NAME
    return module.createMoonshotProvider(settings)
  },
  toolFactories: {
    // Unlike the descriptor-only factories, this one EXECUTES, so it needs a credential. It cannot
    // come from the provider argument: `getToolProvider` re-creates the instance with no settings
    // whenever one is cached, so that provider has no api key. The serving credential is passed
    // through the plugin config instead (buildProviderBuiltinWebSearchConfig).
    webSearch:
      () =>
      (credentials: KimiFormulaCredentials = {}) => {
        if (!moonshotWebSearchToolFactory || !moonshotWebSearchToolName) {
          throw new Error('Moonshot provider module was not loaded before resolving its tools')
        }
        return {
          tools: {
            [moonshotWebSearchToolName]: moonshotWebSearchToolFactory(credentials)
          }
        }
      }
  }
} as const satisfies ProviderExtensionConfig<MoonshotProviderSettings, MoonshotProvider, 'moonshot'>)

/** AiHubMix — multi-backend gateway (claude→anthropic, gemini→google, gpt→openai-responses). */
export const AiHubMixExtension = ProviderExtension.create({
  name: 'aihubmix',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/aihubmix/aihubmixProvider')).createAihubmix(settings)
} as const satisfies ProviderExtensionConfig<AihubmixProviderSettings, ProviderV3, 'aihubmix'>)

/** NewAPI — multi-backend gateway routed by endpoint_type. */
export const NewApiExtension = ProviderExtension.create({
  name: 'newapi',
  aliases: ['new-api', 'o3'] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/newapiProvider')).createNewApi(settings)
} as const satisfies ProviderExtensionConfig<NewApiProviderSettings, ProviderV3, 'newapi'>)

export const TogetherAIExtension = ProviderExtension.create({
  name: 'togetherai',
  aliases: [SystemProviderIds.together] as const,
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/togetherai')).createTogetherAI(settings)
} as const satisfies ProviderExtensionConfig<TogetherAIProviderSettings, ProviderV3, 'togetherai'>)

/**
 * PPIO Extension - unified chat + embedding + image (async submit/poll for painting)
 */
export const PpioExtension = ProviderExtension.create({
  name: 'ppio',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/ppio/ppioProvider')).createPpioProvider(settings)
} as const satisfies ProviderExtensionConfig<PpioProviderSettings, ProviderV3, 'ppio'>)

/**
 * DMXAPI Extension - unified chat + embedding + image (single-shot for painting)
 */
export const DmxapiExtension = ProviderExtension.create({
  name: 'dmxapi',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/dmxapi/dmxapiProvider')).createDmxapiProvider(settings)
} as const satisfies ProviderExtensionConfig<DmxapiProviderSettings, ProviderV3, 'dmxapi'>)

/**
 * SiliconFlow Extension - OpenAI-compatible chat + embedding, URL-returning sync image generation.
 */
export const SiliconExtension = ProviderExtension.create({
  name: 'silicon',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/silicon/siliconProvider')).createSiliconProvider(settings)
} as const satisfies ProviderExtensionConfig<SiliconProviderSettings, ProviderV3, 'silicon'>)

/**
 * Zhipu Extension - OpenAI-compatible chat + embedding, URL-returning sync image generation.
 */
export const ZhipuExtension = ProviderExtension.create({
  name: 'zhipu',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/zhipuProvider')).createZhipuProvider(settings)
} as const satisfies ProviderExtensionConfig<ZhipuProviderSettings, ProviderV3, 'zhipu'>)

/**
 * Doubao (Volcengine Ark) Extension — the official `@ai-sdk/bytedance` provider, for
 * Ark's own image protocol: one `POST /images/generations` for both text-to-image and
 * reference-image edits (the generic OpenAI-compatible model would switch to a multipart
 * `/images/edits`, which Ark does not serve) plus the nested
 * `sequential_image_generation_options.max_images` group-image shape.
 *
 * Only IMAGE models are routed here by `providerToAiSdkConfig` — chat/embedding stay on
 * the generic openai-compatible provider, and this provider throws `NoSuchModelError`
 * for them by design. Params ride under `providerOptions.bytedance`, which is why the
 * wire registration re-keys the body (see `WIRE_REGISTRY.doubao`).
 *
 * Pinned to 1.x: 2.x moves to the `ProviderV4` / `ImageModelV4` specs, which the rest of
 * the app is not on yet. It also ships Seedance video models we don't wire up yet.
 */
export const DoubaoExtension = ProviderExtension.create({
  name: 'doubao',
  supportsImageGeneration: true,
  create: async (settings) => (await import('@ai-sdk/bytedance')).createByteDance(settings)
} as const satisfies ProviderExtensionConfig<ByteDanceProviderSettings, ProviderV3, 'doubao'>)

/**
 * OVMS Extension - unified chat + embedding + image (local OpenVINO Model Server, no auth)
 */
export const OvmsExtension = ProviderExtension.create({
  name: 'ovms',
  supportsImageGeneration: true,
  create: async (settings) => (await import('./custom/ovms/ovmsProvider')).createOvmsProvider(settings)
} as const satisfies ProviderExtensionConfig<OvmsProviderSettings, ProviderV3, 'ovms'>)

/**
 * ModelScope Extension - OpenAI-compatible chat + embedding, async submit/poll image
 * generation via `X-ModelScope-Async-Mode`.
 */
export const ModelscopeExtension = ProviderExtension.create({
  name: 'modelscope',
  supportsImageGeneration: true,
  create: async (settings) =>
    (await import('./custom/modelscope/modelscopeProvider')).createModelscopeProvider(settings)
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
  create: async (settings) => (await import('./custom/dashscope/dashscopeProvider')).createDashScopeProvider(settings)
} as const satisfies ProviderExtensionConfig<DashScopeProviderSettings, ProviderV3, 'dashscope'>)

/**
 * Voyage AI Extension - embeddings and reranking
 */
export const VoyageExtension = ProviderExtension.create({
  name: 'voyage',
  aliases: [SystemProviderIds.voyageai] as const,
  supportsImageGeneration: false,
  create: async (settings) => (await import('voyage-ai-provider')).createVoyage(settings)
} as const satisfies ProviderExtensionConfig<VoyageProviderSettings, ProviderV3, 'voyage'>)

/**
 * Local Embedding Extension - optional in-process text embeddings via
 * transformers.js + onnxruntime-node (no auth, no network). Embedding-only.
 */
export const LocalEmbeddingExtension = ProviderExtension.create({
  name: LOCAL_EMBEDDING_PROVIDER_ID,
  supportsImageGeneration: false,
  create: async (settings) =>
    (await import('./custom/localEmbedding/localEmbeddingProvider')).createLocalEmbeddingProvider(settings)
} as const satisfies ProviderExtensionConfig<
  LocalEmbeddingProviderSettings,
  ProviderV3,
  typeof LOCAL_EMBEDDING_PROVIDER_ID
>)

export const extensions = [
  GoogleVertexExtension,
  GoogleVertexAnthropicExtension,
  GoogleVertexMaaSExtension,
  GitHubCopilotExtension,
  BedrockExtension,
  PerplexityExtension,
  MistralExtension,
  HuggingFaceExtension,
  GatewayExtension,
  CerebrasExtension,
  OllamaExtension,
  MinimaxExtension,
  MoonshotExtension,
  AiHubMixExtension,
  NewApiExtension,
  PpioExtension,
  DmxapiExtension,
  SiliconExtension,
  ZhipuExtension,
  DoubaoExtension,
  OvmsExtension,
  ModelscopeExtension,
  DashScopeExtension,
  VoyageExtension,
  TogetherAIExtension,
  GroqExtension,
  LocalEmbeddingExtension
] as const
