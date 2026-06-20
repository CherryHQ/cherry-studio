/**
 * Main-local copies of the v1 (legacy) data shapes that main-process code still
 * reads: the v1 → v2 migrators (`ProviderModelMigrator` / mappings) and a few
 * legacy services (`MistralClientManager`, `OpenClawService`, `ConfigManager`).
 *
 * v1 is throwaway (see CLAUDE.md "Coexistence Mindset"). These shapes are
 * deliberately NOT shared with the renderer (which keeps its own copy in
 * `src/renderer/types`) and NOT placed in `@shared`, to keep the v1 projection
 * out of the v2 layer. Delete once the last v1 store is migrated and these
 * consumers drop their v1 dependency.
 *
 * @deprecated v1 legacy — do not extend; v2 code uses the data-layer entities in
 * `@shared/data/types/*`.
 */
import type OpenAI from '@cherrystudio/openai'
import type { OpenAIVerbosity } from '@shared/types/aiSdk'

export type ProviderType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'azure-openai'
  | 'vertexai'
  | 'mistral'
  | 'aws-bedrock'
  | 'vertex-anthropic'
  | 'new-api'
  | 'gateway'
  | 'ollama'

export type ModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export type EndpointType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'

export type ModelPricing = {
  input_per_million_tokens: number
  output_per_million_tokens: number
  currencySymbol?: string
}

export type ModelCapability = {
  type: ModelType
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   */
  isUserSelected?: boolean
}

export type Model = {
  id: string
  provider: string
  name: string
  group: string
  owned_by?: string
  description?: string
  capabilities?: ModelCapability[]
  /**
   * @deprecated
   */
  type?: ModelType[]
  pricing?: ModelPricing
  endpoint_type?: EndpointType
  supported_endpoint_types?: EndpointType[]
  supported_text_delta?: boolean
}

// undefined is treated as supported, enabled by default
export type ProviderApiOptions = {
  /** Whether message content of array type is not supported */
  isNotSupportArrayContent?: boolean
  /** Whether the stream_options parameter is not supported */
  isNotSupportStreamOptions?: boolean
  /**
   * @deprecated
   * Whether message role 'developer' is not supported */
  isNotSupportDeveloperRole?: boolean
  /* Whether message role 'developer' is supported */
  isSupportDeveloperRole?: boolean
  /**
   * @deprecated
   * Whether the service_tier parameter is not supported. Only for OpenAI Models. */
  isNotSupportServiceTier?: boolean
  /* Whether the service_tier parameter is supported. Only for OpenAI Models. */
  isSupportServiceTier?: boolean
  /** Whether the enable_thinking parameter is not supported */
  isNotSupportEnableThinking?: boolean
  /** Whether APIVersion is not supported */
  isNotSupportAPIVersion?: boolean
  /** Whether verbosity is not supported. For OpenAI API (completions & responses). */
  isNotSupportVerbosity?: boolean
}

export type OpenAIServiceTier = Exclude<OpenAI.Responses.ResponseCreateParams['service_tier'], 'scale'>

export type GroqServiceTier = 'auto' | 'on_demand' | 'flex' | undefined | null

export type ServiceTier = OpenAIServiceTier | GroqServiceTier

export type AnthropicCacheControlSettings = {
  tokenThreshold: number
  cacheSystemMessage: boolean
  cacheLastNMessages: number
}

export type Provider = {
  id: string
  type: ProviderType
  name: string
  apiKey: string
  apiHost: string
  anthropicApiHost?: string
  isAnthropicModel?: (m: Model) => boolean
  apiVersion?: string
  models: Model[]
  enabled?: boolean
  isSystem?: boolean
  isAuthed?: boolean
  rateLimit?: number

  // API options
  apiOptions?: ProviderApiOptions
  serviceTier?: ServiceTier
  verbosity?: OpenAIVerbosity

  /** @deprecated */
  isNotSupportArrayContent?: boolean
  /** @deprecated */
  isNotSupportStreamOptions?: boolean
  /** @deprecated */
  isNotSupportDeveloperRole?: boolean
  /** @deprecated */
  isNotSupportServiceTier?: boolean

  authType?: 'apiKey' | 'oauth'
  isVertex?: boolean
  notes?: string
  extra_headers?: Record<string, string>
  /** Mirrors `ProviderSchema.presetProviderId` — user-added custom providers
   * may pin themselves to a built-in preset (e.g. `'new-api'`) so SDK
   * resolution can fold them into the preset's image / chat code path. */
  presetProviderId?: string

  // Anthropic prompt caching settings
  anthropicCacheControl?: AnthropicCacheControlSettings
}

export type VertexProvider = Provider & {
  googleCredentials: {
    privateKey: string
    clientEmail: string
  }
  project: string
  location: string
}

export interface Shortcut {
  key: string
  shortcut: string[]
  editable: boolean
  enabled: boolean
  system: boolean
}
