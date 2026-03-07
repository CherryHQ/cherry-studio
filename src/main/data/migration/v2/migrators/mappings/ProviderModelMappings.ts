/**
 * Provider & Model Mappings - Transformation functions for Redux → SQLite migration
 *
 * Converts legacy Provider and Model types to UserProvider and UserModel schema formats.
 *
 * ## Data Flow:
 * - Source: Redux `llm.providers[]` with nested `models[]`
 * - Target: SQLite `user_provider` + `user_model` tables
 */

import {
  ENDPOINT_TYPE,
  type EndpointType,
  MODEL_CAPABILITY,
  type ModelCapability
} from '@cherrystudio/provider-catalog'
import type { NewUserModel } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import type { ApiCompatibility, ApiKeyEntry, AuthConfig, ProviderSettings } from '@shared/data/types/provider'
import type { Model as LegacyModel, Provider as LegacyProvider } from '@types'
import { v4 as uuidv4 } from 'uuid'

/** Legacy LLM Settings from Redux llm.settings */
export interface OldLlmSettings {
  ollama?: { keepAliveTime?: number }
  lmstudio?: { keepAliveTime?: number }
  gpustack?: { keepAliveTime?: number }
  vertexai?: {
    serviceAccount?: {
      privateKey?: string
      clientEmail?: string
    }
    projectId?: string
    location?: string
  }
  awsBedrock?: {
    authType?: string
    accessKeyId?: string
    secretAccessKey?: string
    apiKey?: string
    region?: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mapping Tables
// ═══════════════════════════════════════════════════════════════════════════════

/** Map legacy capability type → new ModelCapability enum */
const CAPABILITY_MAP: Record<string, ModelCapability | undefined> = {
  text: undefined, // Base capability, not mapped
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  rerank: MODEL_CAPABILITY.RERANK
}

/**
 * Map legacy provider type → default EndpointType for baseUrls key.
 *
 * Only includes provider types whose apiHost should be stored under a specific endpoint.
 * Providers with special auth (azure-openai, vertexai, vertex-anthropic, aws-bedrock, mistral)
 * get their endpoint config from the catalog preset — no mapping needed here.
 */
const ENDPOINT_MAP: Record<string, EndpointType> = {
  openai: ENDPOINT_TYPE.CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.RESPONSES,
  anthropic: ENDPOINT_TYPE.MESSAGES,
  gemini: ENDPOINT_TYPE.GENERATE_CONTENT,
  'image-generation': ENDPOINT_TYPE.IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.RERANK,
  'new-api': ENDPOINT_TYPE.CHAT_COMPLETIONS,
  gateway: ENDPOINT_TYPE.CHAT_COMPLETIONS,
  ollama: ENDPOINT_TYPE.OLLAMA_CHAT
}

/** System provider IDs that should have presetProviderId set */
const SYSTEM_PROVIDER_IDS = new Set([
  'cherryin',
  'silicon',
  'aihubmix',
  'ocoolai',
  'deepseek',
  'ppio',
  'alayanew',
  'qiniu',
  'dmxapi',
  'burncloud',
  'tokenflux',
  '302ai',
  'cephalon',
  'lanyun',
  'ph8',
  'openrouter',
  'ollama',
  'ovms',
  'new-api',
  'lmstudio',
  'anthropic',
  'openai',
  'azure-openai',
  'gemini',
  'vertexai',
  'github',
  'copilot',
  'zhipu',
  'yi',
  'moonshot',
  'baichuan',
  'dashscope',
  'stepfun',
  'doubao',
  'infini',
  'minimax',
  'groq',
  'together',
  'fireworks',
  'nvidia',
  'grok',
  'hyperbolic',
  'mistral',
  'jina',
  'perplexity',
  'modelscope',
  'xirang',
  'hunyuan',
  'tencent-cloud-ti',
  'baidu-cloud',
  'gpustack',
  'voyageai',
  'aws-bedrock',
  'poe',
  'aionly',
  'longcat',
  'huggingface',
  'sophnet',
  'gateway',
  'cerebras',
  'mimo',
  'gitee-ai'
])

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Transformation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transform a legacy Provider to NewUserProvider format
 */
export function transformProvider(
  legacy: LegacyProvider,
  settings: OldLlmSettings,
  sortOrder: number
): NewUserProvider {
  const apiKeys = buildApiKeys(legacy.apiKey)
  const endpointType = ENDPOINT_MAP[legacy.type]

  return {
    providerId: legacy.id,
    presetProviderId: SYSTEM_PROVIDER_IDS.has(legacy.id) ? legacy.id : null,
    name: legacy.name,
    baseUrls: buildBaseUrls(legacy, endpointType),
    defaultChatEndpoint: endpointType ?? null,
    apiKeys,
    authConfig: buildAuthConfig(legacy, settings),
    apiCompatibility: buildApiCompatibility(legacy),
    providerSettings: buildProviderSettings(legacy),
    isEnabled: legacy.enabled ?? true,
    sortOrder
  }
}

/**
 * Build baseUrls from legacy provider fields.
 * - apiHost → mapped to the provider's endpoint type key
 * - anthropicApiHost → mapped to MESSAGES endpoint key
 * - Providers not in ENDPOINT_MAP (azure, vertexai, bedrock, etc.) get their
 *   endpoints from the catalog preset, so apiHost is not migrated for them.
 */
function buildBaseUrls(legacy: LegacyProvider, endpointType: EndpointType | undefined): NewUserProvider['baseUrls'] {
  const urls: Partial<Record<EndpointType, string>> = {}

  if (legacy.apiHost && endpointType) {
    urls[endpointType] = legacy.apiHost
  }

  if (legacy.anthropicApiHost) {
    urls[ENDPOINT_TYPE.MESSAGES] = legacy.anthropicApiHost
  }

  return Object.keys(urls).length > 0 ? urls : null
}

/**
 * Split comma-separated API key string into ApiKeyEntry array
 * v1 stores multiple keys as "key1,key2,key3"
 */
function buildApiKeys(apiKey: string): ApiKeyEntry[] {
  if (!apiKey) return []
  const keys = apiKey
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  return keys.map((key) => ({
    id: uuidv4(),
    key,
    isEnabled: true,
    createdAt: Date.now()
  }))
}

/**
 * Build AuthConfig from legacy provider and LLM settings
 */
function buildAuthConfig(legacy: LegacyProvider, settings: OldLlmSettings): AuthConfig | null {
  // VertexAI (GCP IAM)
  if (legacy.isVertex && settings.vertexai) {
    const v = settings.vertexai
    return {
      type: 'iam-gcp',
      project: v.projectId ?? '',
      location: v.location ?? '',
      credentials: v.serviceAccount
        ? { privateKey: v.serviceAccount.privateKey, clientEmail: v.serviceAccount.clientEmail }
        : undefined
    }
  }

  // AWS Bedrock
  if (legacy.id === 'aws-bedrock' && settings.awsBedrock) {
    const aws = settings.awsBedrock
    return {
      type: 'iam-aws',
      region: aws.region ?? '',
      accessKeyId: aws.accessKeyId,
      secretAccessKey: aws.secretAccessKey
    }
  }

  // Azure OpenAI
  if (legacy.id === 'azure-openai' && legacy.apiVersion) {
    return {
      type: 'iam-azure',
      apiVersion: legacy.apiVersion
    }
  }

  // OAuth
  if (legacy.authType === 'oauth') {
    return { type: 'oauth', clientId: '' }
  }

  // Default: API key auth (only set if non-default to save space)
  return { type: 'api-key' }
}

/**
 * Build ApiCompatibility from legacy apiOptions (inverted booleans)
 */
function buildApiCompatibility(legacy: LegacyProvider): ApiCompatibility | null {
  const opts = legacy.apiOptions
  // Also check deprecated top-level fields
  const notArrayContent = opts?.isNotSupportArrayContent ?? legacy.isNotSupportArrayContent
  const notStreamOptions = opts?.isNotSupportStreamOptions ?? legacy.isNotSupportStreamOptions
  const supportDeveloperRole =
    opts?.isSupportDeveloperRole ??
    (legacy.isNotSupportDeveloperRole != null ? !legacy.isNotSupportDeveloperRole : undefined)
  const supportServiceTier =
    opts?.isSupportServiceTier ?? (legacy.isNotSupportServiceTier != null ? !legacy.isNotSupportServiceTier : undefined)

  const features: ApiCompatibility = {}
  let hasValue = false

  if (notArrayContent != null) {
    features.arrayContent = !notArrayContent
    hasValue = true
  }
  if (notStreamOptions != null) {
    features.streamOptions = !notStreamOptions
    hasValue = true
  }
  if (supportDeveloperRole != null) {
    features.developerRole = supportDeveloperRole
    hasValue = true
  }
  if (supportServiceTier != null) {
    features.serviceTier = supportServiceTier
    hasValue = true
  }

  return hasValue ? features : null
}

/**
 * Build ProviderSettings from legacy provider fields
 */
function buildProviderSettings(legacy: LegacyProvider): ProviderSettings | null {
  const settings: ProviderSettings = {}
  let hasValue = false

  if (legacy.serviceTier) {
    settings.serviceTier = legacy.serviceTier as ProviderSettings['serviceTier']
    hasValue = true
  }
  if (legacy.verbosity) {
    settings.verbosity = legacy.verbosity as ProviderSettings['verbosity']
    hasValue = true
  }
  if (legacy.rateLimit != null) {
    settings.rateLimit = legacy.rateLimit
    hasValue = true
  }
  if (legacy.extra_headers && Object.keys(legacy.extra_headers).length > 0) {
    settings.extraHeaders = legacy.extra_headers
    hasValue = true
  }
  if (legacy.anthropicCacheControl) {
    settings.cacheControl = {
      enabled: true,
      tokenThreshold: legacy.anthropicCacheControl.tokenThreshold,
      cacheSystemMessage: legacy.anthropicCacheControl.cacheSystemMessage,
      cacheLastNMessages: legacy.anthropicCacheControl.cacheLastNMessages
    }
    hasValue = true
  }

  return hasValue ? settings : null
}

/**
 * Transform a legacy Model to NewUserModel format
 */
export function transformModel(legacy: LegacyModel, providerId: string, sortOrder: number): NewUserModel {
  return {
    providerId,
    modelId: legacy.id,
    modelApiId: legacy.id,
    presetModelId: null,
    name: legacy.name || null,
    description: legacy.description || null,
    group: legacy.group || null,
    capabilities: mapCapabilities(legacy.capabilities),
    inputModalities: null,
    outputModalities: null,
    endpointTypes: mapEndpointTypes(legacy.endpoint_type, legacy.supported_endpoint_types),
    contextWindow: null,
    maxOutputTokens: null,
    supportsStreaming: legacy.supported_text_delta ?? null,
    reasoning: null,
    parameters: null,
    isEnabled: true,
    isHidden: false,
    sortOrder
  }
}

/**
 * Map legacy capabilities to new ModelCapability values
 */
function mapCapabilities(caps?: LegacyModel['capabilities']): ModelCapability[] | null {
  if (!caps || caps.length === 0) return null

  const mapped: ModelCapability[] = []
  for (const cap of caps) {
    const newCap = CAPABILITY_MAP[cap.type]
    if (newCap) {
      mapped.push(newCap)
    }
  }

  return mapped.length > 0 ? mapped : null
}

/**
 * Map legacy endpoint types to new EndpointType values
 */
function mapEndpointTypes(endpointType?: string, supportedTypes?: string[]): EndpointType[] | null {
  const types = supportedTypes ?? (endpointType ? [endpointType] : [])
  if (types.length === 0) return null

  const mapped: EndpointType[] = []
  for (const t of types) {
    const newType = ENDPOINT_MAP[t]
    if (newType) {
      mapped.push(newType)
    }
  }

  return mapped.length > 0 ? mapped : null
}
