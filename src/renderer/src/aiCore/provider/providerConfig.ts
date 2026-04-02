import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { AppProviderId, AppProviderSettingsMap } from '@renderer/aiCore/types'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockApiKey,
  getAwsBedrockAuthType,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getProviderById } from '@renderer/services/ProviderService'
import store from '@renderer/store'
import { type Model, type Provider, SystemProviderIds } from '@renderer/types'
import {
  formatApiHost,
  formatAzureOpenAIApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  isWithTrailingSharp,
  routeToEndpoint
} from '@renderer/utils/api'
import {
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isSupportStreamOptionsProvider,
  isVertexProvider
} from '@renderer/utils/provider'
import { defaultAppHeaders } from '@shared/utils'
import { cloneDeep, isEmpty } from 'lodash'

import type { ProviderConfig } from '../types'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'

// === Types ===

interface BaseConfig {
  baseURL: string
  apiKey: string
}

interface BuilderContext {
  actualProvider: Provider
  model: Model
  baseConfig: BaseConfig
  endpoint?: string
  aiSdkProviderId: AppProviderId
}

// === Host Formatting ===

type HostFormatter = {
  match: (provider: Provider) => boolean
  format: (provider: Provider, appendApiVersion: boolean) => string
}

// WARNING: if any changes are made here, please sync it to src/main/aiCore/provider/providerConfig.ts:formatProviderApiHost
export function formatProviderApiHost(provider: Provider): Provider {
  const formatted = { ...provider }
  const appendApiVersion = !isWithTrailingSharp(provider.apiHost)

  if (formatted.anthropicApiHost) {
    formatted.anthropicApiHost = formatApiHost(formatted.anthropicApiHost, appendApiVersion)
  }

  // Anthropic is special: uses anthropicApiHost as source and syncs both fields
  if (isAnthropicProvider(provider)) {
    const baseHost = formatted.anthropicApiHost || formatted.apiHost
    formatted.apiHost = formatApiHost(baseHost, appendApiVersion)
    if (!formatted.anthropicApiHost) {
      formatted.anthropicApiHost = formatted.apiHost
    }
    return formatted
  }

  const formatters: HostFormatter[] = [
    {
      match: (p) => p.id === SystemProviderIds.copilot || p.id === SystemProviderIds.github,
      format: (p) => formatApiHost(p.apiHost, false)
    },
    { match: isCherryAIProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isPerplexityProvider, format: (p) => formatApiHost(p.apiHost, false) },
    { match: isOllamaProvider, format: (p) => formatOllamaApiHost(p.apiHost) },
    { match: isGeminiProvider, format: (p, av) => formatApiHost(p.apiHost, av, 'v1beta') },
    { match: isAzureOpenAIProvider, format: (p) => formatAzureOpenAIApiHost(p.apiHost) },
    { match: isVertexProvider, format: (p) => formatVertexApiHost(p as Parameters<typeof formatVertexApiHost>[0]) }
  ]

  const formatter = formatters.find((f) => f.match(provider))
  formatted.apiHost = formatter
    ? formatter.format(formatted, appendApiVersion)
    : formatApiHost(formatted.apiHost, appendApiVersion)

  return formatted
}

// === SDK Config Building ===

type ConfigBuilderEntry = {
  match: (provider: Provider, aiSdkProviderId: AppProviderId) => boolean
  build: (ctx: BuilderContext) => ProviderConfig | Promise<ProviderConfig>
}

export function providerToAiSdkConfig(
  actualProvider: Provider,
  model: Model
): ProviderConfig | Promise<ProviderConfig> {
  const aiSdkProviderId = getAiSdkProviderId(actualProvider)
  const { baseURL, endpoint } = routeToEndpoint(actualProvider.apiHost)

  const ctx: BuilderContext = {
    actualProvider,
    model,
    baseConfig: { baseURL, apiKey: actualProvider.apiKey },
    endpoint,
    aiSdkProviderId
  }

  const builders: ConfigBuilderEntry[] = [
    { match: (p) => p.id === SystemProviderIds.copilot, build: buildCopilotConfig },
    { match: (p) => p.id === 'cherryai', build: buildCherryAIConfig },
    { match: (p) => p.id === 'anthropic' && p.authType === 'oauth', build: buildAnthropicConfig },
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    { match: (_, id) => id === 'google-vertex', build: buildVertexConfig },
    { match: (_, id) => id === 'cherryin', build: buildCherryinConfig },
    { match: (_, id) => id === 'newapi', build: buildNewApiConfig },
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig }
  ]

  const builder = builders.find((b) => b.match(actualProvider, aiSdkProviderId))
  if (builder) {
    return builder.build(ctx)
  }

  // SDK-supported provider → generic config; otherwise → openai-compatible fallback
  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    return buildGenericProviderConfig(ctx)
  }
  return buildOpenAICompatibleConfig(ctx)
}

// === Public API ===

export function getActualProvider(model: Model): Provider {
  return adaptProvider({ provider: getProviderByModel(model), model })
}

export function adaptProvider({ provider }: { provider: Provider; model?: Model }): Provider {
  return formatProviderApiHost(cloneDeep(provider))
}

export function isModernSdkSupported(provider: Provider): boolean {
  return hasProviderConfig(getAiSdkProviderId(provider))
}

// === Config Builders ===

function buildCommonOptions(ctx: BuilderContext) {
  const options: Record<string, any> = {
    headers: {
      ...defaultAppHeaders(),
      ...ctx.actualProvider.extra_headers
    }
  }
  if (ctx.aiSdkProviderId === 'openai') {
    options.headers['X-Api-Key'] = ctx.baseConfig.apiKey
  }
  return options
}

async function buildCopilotConfig(ctx: BuilderContext): Promise<ProviderConfig<'github-copilot-openai-compatible'>> {
  const storedHeaders = store.getState().copilot.defaultHeaders ?? {}
  const headers = { ...COPILOT_DEFAULT_HEADERS, ...storedHeaders }
  const { token } = await window.api.copilot.getToken(headers)

  return {
    providerId: 'github-copilot-openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      apiKey: token,
      headers: { ...headers, ...ctx.actualProvider.extra_headers },
      name: ctx.actualProvider.id
    }
  }
}

function buildOllamaConfig(ctx: BuilderContext): ProviderConfig<'ollama'> {
  const headers: ProviderConfig<'ollama'>['providerSettings']['headers'] = {
    ...defaultAppHeaders(),
    ...ctx.actualProvider.extra_headers
  }
  if (!isEmpty(ctx.baseConfig.apiKey)) {
    headers.Authorization = `Bearer ${ctx.baseConfig.apiKey}`
  }

  return {
    providerId: 'ollama',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, headers }
  }
}

function buildBedrockConfig(ctx: BuilderContext): ProviderConfig<'bedrock'> {
  const authType = getAwsBedrockAuthType()
  const region = getAwsBedrockRegion()

  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  if (authType === 'apiKey') {
    return { ...base, providerSettings: { ...ctx.baseConfig, region, apiKey: getAwsBedrockApiKey() } }
  }
  return {
    ...base,
    providerSettings: {
      ...ctx.baseConfig,
      region,
      accessKeyId: getAwsBedrockAccessKeyId(),
      secretAccessKey: getAwsBedrockSecretAccessKey()
    }
  }
}

function buildVertexConfig(
  ctx: BuilderContext
): ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'> {
  if (!isVertexAIConfigured()) {
    throw new Error('VertexAI is not configured. Please configure project, location and service account credentials.')
  }

  const { project, location, googleCredentials } = createVertexProvider(ctx.actualProvider)
  // Vertex 上的 Claude 模型走 google-vertex-anthropic variant
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic' || ctx.model.id.startsWith('claude')
  const baseURL = ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')
  const creds = { ...googleCredentials, privateKey: formatPrivateKey(googleCredentials.privateKey) }

  return {
    providerId: isAnthropic ? 'google-vertex-anthropic' : 'google-vertex',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, baseURL, project, location, googleCredentials: creds }
  } as ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'>
}

function buildCherryinConfig(ctx: BuilderContext): ProviderConfig<'cherryin'> {
  const cherryinProvider = getProviderById(SystemProviderIds.cherryin)

  return {
    providerId: 'cherryin',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      endpointType: ctx.model.endpoint_type,
      anthropicBaseURL: cherryinProvider ? cherryinProvider.anthropicApiHost + '/v1' : undefined,
      geminiBaseURL: cherryinProvider ? cherryinProvider.apiHost + '/v1beta/models' : undefined,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

async function buildCherryAIConfig(ctx: BuilderContext): Promise<ProviderConfig<'openai-compatible'>> {
  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      name: ctx.actualProvider.id,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const signature = await window.api.cherryai.generateSignature({
          method: 'POST',
          path: '/chat/completions',
          query: '',
          body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        })
        return fetch(input, { ...init, headers: { ...init?.headers, ...signature } })
      }
    }
  }
}

function buildAzureConfig(
  ctx: BuilderContext
): ProviderConfig<'azure'> | ProviderConfig<'azure-responses'> | ProviderConfig<'azure-anthropic'> {
  // Azure 上的 Claude 模型走 azure-anthropic variant（内部使用 Anthropic SDK）
  if (ctx.model.id.startsWith('claude')) {
    return {
      providerId: 'azure-anthropic',
      endpoint: ctx.endpoint,
      providerSettings: {
        ...ctx.baseConfig,
        headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
      }
    }
  }

  const apiVersion = ctx.actualProvider.apiVersion?.trim()
  const useResponsesMode = apiVersion && ['preview', 'v1'].includes(apiVersion)

  const providerSettings: ProviderConfig<'azure'>['providerSettings'] = {
    ...ctx.baseConfig,
    headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
  }

  if (apiVersion) {
    providerSettings.apiVersion = apiVersion
    if (!useResponsesMode) {
      providerSettings.useDeploymentBasedUrls = true
    }
  }

  return {
    providerId: useResponsesMode ? 'azure-responses' : 'azure',
    endpoint: ctx.endpoint,
    providerSettings
  } as ProviderConfig<'azure'> | ProviderConfig<'azure-responses'>
}

async function buildAnthropicConfig(ctx: BuilderContext): Promise<ProviderConfig<'anthropic'>> {
  const oauthToken: string = await window.api.anthropic_oauth.getAccessToken()

  return {
    providerId: 'anthropic',
    endpoint: ctx.endpoint,
    providerSettings: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: '',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        Authorization: `Bearer ${oauthToken}`
      }
    }
  }
}

function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions, name: ctx.actualProvider.id, includeUsage }
  }
}

function buildGenericProviderConfig(ctx: BuilderContext): ProviderConfig {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: ctx.aiSdkProviderId as StringKeys<AppProviderSettingsMap>,
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions }
  }
}

function buildAiHubMixConfig(ctx: BuilderContext): ProviderConfig<'aihubmix'> {
  return {
    providerId: 'aihubmix',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

function buildNewApiConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      endpointType: ctx.model.endpoint_type,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}
