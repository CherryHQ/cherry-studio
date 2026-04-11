/**
 * Provider configuration builder — v2 DataApi types.
 *
 * Converts v2 Provider + Model into ProviderConfig for @cherrystudio/ai-core.
 * API key resolved via providerService.getRotatedApiKey() (async).
 * Auth config via providerService.getAuthConfig() for IAM providers.
 */

import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import { providerService } from '@main/data/services/ProviderService'
import { generateSignature } from '@main/integration/cherryai'
import { anthropicService } from '@main/services/AnthropicService'
import { copilotService } from '@main/services/CopilotService'
import { formatOllamaApiHost } from '@shared/aiCore/provider/utils'
import { isAzureOpenAIProvider, isGeminiProvider, isOllamaProvider } from '@shared/config/providerChecks'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { formatApiHost, isWithTrailingSharp } from '@shared/utils/api'
import { SystemProviderIds } from '@types'
import { isEmpty } from 'lodash'

import type { ProviderConfig } from '../types'
import { type AppProviderId, type AppProviderSettingsMap } from '../types'
import { getBaseUrl, getExtraHeaders, routeToEndpoint } from '../utils/provider'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { getAiSdkProviderId } from './factory'

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

// ── Host Formatting (v2) ──

/**
 * Format the provider's base URL for API calls.
 * In v2, the base URL comes from endpointConfigs, not a flat apiHost field.
 */
function formatBaseUrl(provider: Provider): string {
  const rawUrl = getBaseUrl(provider)
  if (!rawUrl) return ''

  const appendApiVersion = !isWithTrailingSharp(rawUrl)

  if (provider.presetProviderId === 'anthropic' || provider.id === 'anthropic') {
    // Check for anthropic-specific endpoint (messages)
    const anthropicUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
    return formatApiHost(anthropicUrl || rawUrl, appendApiVersion)
  }

  if (isOllamaProvider(provider)) return formatOllamaApiHost(rawUrl)
  if (isGeminiProvider(provider)) return formatApiHost(rawUrl, appendApiVersion, 'v1beta')

  // Most providers: format with API version
  const noVersionProviders = ['copilot', 'github', 'cherryai', 'perplexity', 'newapi', 'new-api', 'azure-openai']
  if (noVersionProviders.includes(provider.id) || noVersionProviders.includes(provider.presetProviderId ?? '')) {
    return formatApiHost(rawUrl, false)
  }

  return formatApiHost(rawUrl, appendApiVersion)
}

// ── SDK Config Building ──

type ConfigBuilderEntry = {
  match: (provider: Provider, aiSdkProviderId: AppProviderId) => boolean
  build: (ctx: BuilderContext) => ProviderConfig | Promise<ProviderConfig>
}

/**
 * Build AI SDK provider config from v2 Provider + Model.
 * Always async (getRotatedApiKey is async).
 */
export async function providerToAiSdkConfig(provider: Provider, model: Model): Promise<ProviderConfig> {
  const aiSdkProviderId = getAiSdkProviderId(provider)

  // Get base URL and parse endpoint
  const formattedBaseUrl = formatBaseUrl(provider)
  const { baseURL, endpoint } = routeToEndpoint(formattedBaseUrl)

  // Get API key (async, round-robin)
  const apiKey = await providerService.getRotatedApiKey(provider.id)

  const ctx: BuilderContext = {
    actualProvider: provider,
    model,
    baseConfig: { baseURL, apiKey },
    endpoint,
    aiSdkProviderId
  }

  const builders: ConfigBuilderEntry[] = [
    { match: (p) => p.id === SystemProviderIds.copilot, build: buildCopilotConfig },
    { match: (p) => p.id === 'cherryai', build: buildCherryAIConfig },
    { match: (p) => p.id === 'anthropic' && p.authType === 'oauth', build: buildAnthropicOAuthConfig },
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    { match: (_, id) => id === 'google-vertex', build: buildVertexConfig },
    { match: (_, id) => id === 'cherryin', build: buildCherryinConfig },
    { match: (_, id) => id === 'newapi', build: buildNewApiConfig },
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig }
  ]

  const builder = builders.find((b) => b.match(provider, aiSdkProviderId))
  if (builder) {
    return builder.build(ctx)
  }

  if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    return buildGenericProviderConfig(ctx)
  }
  return buildOpenAICompatibleConfig(ctx)
}

// ── Config Builders ──

async function buildCopilotConfig(ctx: BuilderContext): Promise<ProviderConfig<'github-copilot-openai-compatible'>> {
  const storedHeaders = {} // TODO: read from PreferenceService if copilot headers are persisted
  const headers = { ...COPILOT_DEFAULT_HEADERS, ...storedHeaders }
  const { token } = await copilotService.getToken(null as any, headers)

  return {
    providerId: 'github-copilot-openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      apiKey: token,
      headers: { ...headers, ...getExtraHeaders(ctx.actualProvider) },
      name: ctx.actualProvider.id
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
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const signature = generateSignature({
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

async function buildAnthropicOAuthConfig(ctx: BuilderContext): Promise<ProviderConfig<'anthropic'>> {
  const oauthToken = await anthropicService.getValidAccessToken()

  if (!oauthToken) {
    throw new Error('Anthropic OAuth: no valid access token. Please re-authorize.')
  }

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

function buildCommonOptions(ctx: BuilderContext) {
  const options: Record<string, any> = {
    headers: {
      ...defaultAppHeaders(),
      ...getExtraHeaders(ctx.actualProvider)
    }
  }
  if (ctx.aiSdkProviderId === 'openai') {
    options.headers['X-Api-Key'] = ctx.baseConfig.apiKey
  }
  return options
}

function buildOllamaConfig(ctx: BuilderContext): ProviderConfig<'ollama'> {
  const headers: Record<string, string> = {
    ...defaultAppHeaders(),
    ...getExtraHeaders(ctx.actualProvider)
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

async function buildBedrockConfig(ctx: BuilderContext): Promise<ProviderConfig<'bedrock'>> {
  // v2: get full auth config from DB (includes IAM credentials)
  const authConfig = await providerService.getAuthConfig(ctx.actualProvider.id)
  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  if (authConfig?.type === 'iam-aws') {
    return {
      ...base,
      providerSettings: {
        ...ctx.baseConfig,
        region: authConfig.region,
        ...(authConfig.accessKeyId && { accessKeyId: authConfig.accessKeyId }),
        ...(authConfig.secretAccessKey && { secretAccessKey: authConfig.secretAccessKey })
      }
    }
  }

  // Fallback: API key auth
  return { ...base, providerSettings: { ...ctx.baseConfig, region: 'us-east-1' } }
}

async function buildVertexConfig(ctx: BuilderContext): Promise<ProviderConfig<'google-vertex'>> {
  // v2: get full auth config from DB (includes GCP credentials)
  const authConfig = await providerService.getAuthConfig(ctx.actualProvider.id)

  if (authConfig?.type !== 'iam-gcp') {
    throw new Error('VertexAI requires iam-gcp auth configuration.')
  }

  const { project, location, credentials } = authConfig
  const googleCredentials = credentials as Record<string, string> | undefined

  const modelId = ctx.model.apiModelId ?? ctx.model.id
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic' || modelId.startsWith('claude')
  const baseURL = ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')

  const creds = googleCredentials
    ? { ...googleCredentials, privateKey: formatPrivateKey(googleCredentials.privateKey ?? '') }
    : undefined

  return {
    providerId: isAnthropic ? 'google-vertex-anthropic' : 'google-vertex',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      project,
      location,
      ...(creds && { googleCredentials: creds })
    }
  } as ProviderConfig<'google-vertex'>
}

function mapCherryinEndpointType(epType: string | undefined): CherryInProviderSettings['endpointType'] {
  if (!epType) return undefined

  switch (epType) {
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'gemini'
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OLLAMA_CHAT:
      return 'openai'
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-response'
    case ENDPOINT_TYPE.JINA_RERANK:
      return 'jina-rerank'
    default:
      return undefined
  }
}

async function buildCherryinConfig(ctx: BuilderContext): Promise<ProviderConfig> {
  // v2: look up cherryin provider for anthropic/gemini base URLs
  let anthropicBaseURL: string | undefined
  let geminiBaseURL: string | undefined
  try {
    const cherryinProvider = await providerService.getByProviderId(SystemProviderIds.cherryin)
    const anthropicUrl = cherryinProvider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
    anthropicBaseURL = anthropicUrl ? anthropicUrl + '/v1' : undefined
    const geminiUrl = getBaseUrl(cherryinProvider)
    geminiBaseURL = geminiUrl ? geminiUrl + '/v1beta' : undefined
  } catch {
    // CherryIn provider may not exist
  }

  const endpointType = ctx.model.endpointTypes?.[0]
  const cherryinEndpointType = mapCherryinEndpointType(endpointType)
  const useChatVariant = !cherryinEndpointType || cherryinEndpointType === 'openai'

  return {
    providerId: useChatVariant ? 'cherryin-chat' : 'cherryin',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      endpointType: cherryinEndpointType,
      anthropicBaseURL,
      geminiBaseURL,
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}

function formatAzureBaseURL(baseURL: string, forAnthropic: boolean): string {
  const normalized = baseURL.replace(/\/v1$/, '').replace(/\/openai$/, '')
  return forAnthropic ? normalized : normalized + '/openai'
}

function buildAzureConfig(ctx: BuilderContext): ProviderConfig<'azure'> {
  const modelId = ctx.model.apiModelId ?? ctx.model.id
  if (modelId.startsWith('claude')) {
    return {
      providerId: 'azure-anthropic',
      endpoint: ctx.endpoint,
      providerSettings: {
        ...ctx.baseConfig,
        baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, true),
        headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
      }
    } as any
  }

  const apiVersion = ctx.actualProvider.settings?.apiVersion?.trim()
  const useResponsesMode = apiVersion && ['preview', 'v1'].includes(apiVersion)

  const providerSettings: any = {
    ...ctx.baseConfig,
    baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, false),
    headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
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
  } as ProviderConfig<'azure'>
}

function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions, name: ctx.actualProvider.id }
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
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}

function buildNewApiConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  const baseURL = formatApiHost(ctx.baseConfig.baseURL, true)

  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      endpointType: ctx.model.endpointTypes?.[0] as any,
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}
