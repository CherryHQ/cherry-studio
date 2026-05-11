/**
 * Provider/model migration transforms for Redux llm -> SQLite user tables.
 */

import {
  ENDPOINT_TYPE,
  type EndpointType,
  MODEL_CAPABILITY,
  type ModelCapability,
  normalizeModelId
} from '@cherrystudio/provider-registry'
import type { NewUserModel } from '@data/db/schemas/userModel'
import type { NewUserProvider } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { createUniqueModelId, type RuntimeModelPricing } from '@shared/data/types/model'
import type {
  ApiFeatures,
  ApiKeyEntry,
  AuthConfig,
  EndpointConfig,
  ProviderSettings,
  ReasoningFormatType
} from '@shared/data/types/provider'
import type { Model as LegacyModel, ModelType, Provider as LegacyProvider } from '@types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('ProviderModelMappings')

/** Legacy llm.settings structure used by a few providers. */
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
  cherryIn?: {
    accessToken?: string
    refreshToken?: string
  }
}

const CAPABILITY_MAP: Partial<Record<ModelType, ModelCapability | undefined>> = {
  text: undefined,
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  rerank: MODEL_CAPABILITY.RERANK
}

/** Legacy string endpoint/provider-type keys → EndpointType */
const ENDPOINT_MAP: Partial<Record<string, EndpointType>> = {
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.OPENAI_RESPONSES,
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'azure-openai': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  vertexai: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'image-generation': ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.JINA_RERANK,
  'new-api': ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  gateway: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ollama: ENDPOINT_TYPE.OLLAMA_CHAT
}

const PROVIDER_TYPES_WITHOUT_DEFAULT_ENDPOINT = new Set(['aws-bedrock'])

const REASONING_FORMAT_MAP: Partial<Record<LegacyProvider['type'], ReasoningFormatType>> = {
  openai: 'openai-chat',
  'openai-response': 'openai-responses',
  anthropic: 'anthropic',
  gemini: 'gemini',
  'new-api': 'openai-chat',
  gateway: 'openai-chat',
  ollama: 'openai-chat'
}

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
  'gitee-ai',
  'minimax-global',
  'zai'
])

type NewUserProviderInput = Omit<NewUserProvider, 'orderKey'>

export function transformProvider(legacy: LegacyProvider, settings: OldLlmSettings): NewUserProviderInput {
  const endpointType = ENDPOINT_MAP[legacy.type]
  if (legacy.type && !endpointType && !PROVIDER_TYPES_WITHOUT_DEFAULT_ENDPOINT.has(legacy.type)) {
    logger.warn('Unknown provider type dropped during migration', { providerId: legacy.id, legacyType: legacy.type })
  }

  return {
    providerId: legacy.id,
    presetProviderId: SYSTEM_PROVIDER_IDS.has(legacy.id) ? legacy.id : null,
    name: legacy.name,
    endpointConfigs: buildEndpointConfigs(legacy, endpointType),
    defaultChatEndpoint: endpointType ?? null,
    apiKeys: buildProviderApiKeys(legacy, settings),
    authConfig: buildAuthConfig(legacy, settings),
    apiFeatures: buildApiFeatures(legacy),
    providerSettings: buildProviderSettings(legacy, settings),
    isEnabled: legacy.enabled ?? true
  }
}

function buildEndpointConfigs(
  legacy: LegacyProvider,
  endpointType: EndpointType | undefined
): NewUserProvider['endpointConfigs'] {
  const configs: Partial<Record<EndpointType, EndpointConfig>> = {}

  if (legacy.apiHost && endpointType !== undefined) {
    configs[endpointType] = { ...configs[endpointType], baseUrl: legacy.apiHost }
  }

  if (legacy.anthropicApiHost) {
    const ep = ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    configs[ep] = { ...configs[ep], baseUrl: legacy.anthropicApiHost }
  }

  // Assign reasoning format type to the default endpoint
  const reasoningFormatType = REASONING_FORMAT_MAP[legacy.type]
  if (endpointType !== undefined && reasoningFormatType) {
    configs[endpointType] = { ...configs[endpointType], reasoningFormatType }
  }

  return Object.keys(configs).length > 0 ? configs : null
}

function buildApiKeys(apiKey: string): ApiKeyEntry[] {
  if (!apiKey) {
    return []
  }

  return apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => ({
      id: uuidv4(),
      key,
      isEnabled: true
    }))
}

function buildProviderApiKeys(legacy: LegacyProvider, settings: OldLlmSettings): ApiKeyEntry[] {
  if (legacy.id === 'aws-bedrock' && settings.awsBedrock?.authType === 'apiKey') {
    return buildApiKeys(settings.awsBedrock.apiKey ?? '')
  }

  return buildApiKeys(legacy.apiKey)
}

function buildAuthConfig(legacy: LegacyProvider, settings: OldLlmSettings): AuthConfig | null {
  if (legacy.isVertex) {
    const vertex = settings.vertexai
    return {
      type: 'iam-gcp',
      project: vertex?.projectId ?? '',
      location: vertex?.location ?? '',
      credentials: vertex?.serviceAccount
        ? {
            privateKey: vertex.serviceAccount.privateKey,
            clientEmail: vertex.serviceAccount.clientEmail
          }
        : undefined
    }
  }

  if (legacy.id === 'aws-bedrock') {
    const aws = settings.awsBedrock
    if (aws?.authType === 'apiKey') {
      return { type: 'api-key' }
    }

    return {
      type: 'iam-aws',
      region: aws?.region ?? '',
      accessKeyId: aws?.accessKeyId,
      secretAccessKey: aws?.secretAccessKey
    }
  }

  if (legacy.id === 'azure-openai') {
    return {
      type: 'iam-azure',
      apiVersion: legacy.apiVersion ?? ''
    }
  }

  if (
    legacy.id === 'cherryin' &&
    settings.cherryIn &&
    (settings.cherryIn.accessToken || settings.cherryIn.refreshToken)
  ) {
    return {
      type: 'oauth',
      clientId: '',
      accessToken: settings.cherryIn.accessToken,
      refreshToken: settings.cherryIn.refreshToken
    }
  }

  if (legacy.authType === 'oauth') {
    return {
      type: 'oauth',
      clientId: ''
    }
  }

  return {
    type: 'api-key'
  }
}

function buildApiFeatures(legacy: LegacyProvider): ApiFeatures | null {
  const apiOptions = legacy.apiOptions
  const features: ApiFeatures = {}
  let hasValue = false

  const notArrayContent = apiOptions?.isNotSupportArrayContent ?? legacy.isNotSupportArrayContent
  if (notArrayContent != null) {
    features.arrayContent = !notArrayContent
    hasValue = true
  }

  const notStreamOptions = apiOptions?.isNotSupportStreamOptions ?? legacy.isNotSupportStreamOptions
  if (notStreamOptions != null) {
    features.streamOptions = !notStreamOptions
    hasValue = true
  }

  const supportsDeveloperRole =
    apiOptions?.isSupportDeveloperRole ??
    (legacy.isNotSupportDeveloperRole != null ? !legacy.isNotSupportDeveloperRole : undefined)
  if (supportsDeveloperRole != null) {
    features.developerRole = supportsDeveloperRole
    hasValue = true
  }

  const supportsServiceTier =
    apiOptions?.isSupportServiceTier ??
    (legacy.isNotSupportServiceTier != null ? !legacy.isNotSupportServiceTier : undefined)
  if (supportsServiceTier != null) {
    features.serviceTier = supportsServiceTier
    hasValue = true
  }

  if (apiOptions?.isNotSupportEnableThinking != null) {
    features.enableThinking = !apiOptions.isNotSupportEnableThinking
    hasValue = true
  }

  if (apiOptions?.isNotSupportVerbosity != null) {
    features.verbosity = !apiOptions.isNotSupportVerbosity
    hasValue = true
  }

  return hasValue ? features : null
}

function buildProviderSettings(legacy: LegacyProvider, llmSettings: OldLlmSettings): ProviderSettings | null {
  const settings: ProviderSettings = {}
  let hasValue = false

  const keepAliveSettingsKey: Partial<Record<LegacyProvider['id'], keyof OldLlmSettings>> = {
    ollama: 'ollama',
    lmstudio: 'lmstudio',
    gpustack: 'gpustack'
  }

  const keepAliveSource = keepAliveSettingsKey[legacy.id]
  if (keepAliveSource) {
    const keepAliveSettings = llmSettings[keepAliveSource] as { keepAliveTime?: number } | undefined
    if (keepAliveSettings?.keepAliveTime != null) {
      settings.keepAliveTime = keepAliveSettings.keepAliveTime
      hasValue = true
    }
  }

  if (legacy.serviceTier) {
    settings.serviceTier = legacy.serviceTier
    hasValue = true
  }

  if (legacy.verbosity) {
    settings.verbosity = legacy.verbosity
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

  if (legacy.notes) {
    settings.notes = legacy.notes
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

export function transformModel(legacy: LegacyModel, providerId: string): Omit<NewUserModel, 'orderKey'> {
  const hasCustomizedCapabilities =
    legacy.capabilities?.some((capability) => capability.isUserSelected !== undefined) ?? false

  return {
    id: createUniqueModelId(providerId, legacy.id),
    providerId,
    modelId: legacy.id,
    presetModelId: normalizeModelId(legacy.id),
    name: legacy.name ?? null,
    description: legacy.description ?? null,
    group: legacy.group ?? null,
    capabilities: mapCapabilities(legacy.capabilities),
    inputModalities: null,
    outputModalities: null,
    endpointTypes: mapEndpointTypes(legacy.endpoint_type, legacy.supported_endpoint_types),
    contextWindow: null,
    maxOutputTokens: null,
    supportsStreaming: legacy.supported_text_delta ?? true,
    reasoning: null,
    parameters: null,
    pricing: mapPricing(legacy.pricing),
    isEnabled: true,
    isHidden: false,
    userOverrides: hasCustomizedCapabilities ? ['capabilities'] : null
  }
}

function mapCapabilities(capabilities?: LegacyModel['capabilities']): ModelCapability[] {
  if (!capabilities || capabilities.length === 0) {
    return []
  }

  const mapped: ModelCapability[] = []
  for (const capability of capabilities) {
    const result = CAPABILITY_MAP[capability.type]
    if (result !== undefined) {
      mapped.push(result)
    } else if (capability.type !== 'text') {
      logger.warn('Unknown capability type dropped during migration', { type: capability.type })
    }
  }

  return mapped.length > 0 ? Array.from(new Set(mapped)) : []
}

function mapEndpointTypes(
  endpointType?: LegacyModel['endpoint_type'],
  supportedEndpointTypes?: LegacyModel['supported_endpoint_types']
): EndpointType[] | null {
  const sourceTypes = supportedEndpointTypes ?? (endpointType ? [endpointType] : [])
  if (sourceTypes.length === 0) {
    return null
  }

  const mapped: EndpointType[] = []
  for (const type of sourceTypes) {
    if (!type) continue
    const result = ENDPOINT_MAP[type]
    if (result !== undefined) {
      mapped.push(result)
    } else {
      logger.warn('Unknown endpoint type dropped during migration', { endpointType: type })
    }
  }

  return mapped.length > 0 ? Array.from(new Set(mapped)) : null
}

function mapPricing(pricing?: LegacyModel['pricing']): RuntimeModelPricing | null {
  if (!pricing) {
    return null
  }

  return {
    input: { perMillionTokens: pricing.input_per_million_tokens },
    output: { perMillionTokens: pricing.output_per_million_tokens }
  }
}
