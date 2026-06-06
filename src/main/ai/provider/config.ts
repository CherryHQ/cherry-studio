/**
 * `Provider + Model` → `ProviderConfig` for `@cherrystudio/ai-core`.
 * Always async because `providerService.getRotatedApiKey` is async.
 */

import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import { providerService } from '@main/data/services/ProviderService'
import { generateSignature } from '@main/integration/cherryai'
import { copilotService } from '@main/services/CopilotService'
import type { EndpointType, Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { formatApiHost, formatOllamaApiHost, isWithTrailingSharp } from '@shared/utils/api'
import { isAzureOpenAIProvider, isGeminiProvider, isOllamaProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'
import { isEmpty } from 'lodash'

import type { ProviderConfig } from '../types'
import { type AppProviderId, appProviderIds, type AppProviderSettingsMap } from '../types'
import { getBaseUrl, getExtraHeaders, routeToEndpoint } from '../utils/provider'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint } from './endpoint'

interface BaseConfig {
  baseURL: string
  apiKey: string
}

interface BuilderContext {
  actualProvider: Provider
  model: Model
  baseConfig: BaseConfig
  endpoint?: string
  aiSdkProviderId: StringKeys<AppProviderSettingsMap>
}

/** Applies endpoint-/provider-specific formatting (API version, Ollama/Gemini paths). */
function formatBaseURL(baseURL: string, provider: Provider, endpointType?: EndpointType): string {
  if (!baseURL) return ''

  const appendApiVersion = !isWithTrailingSharp(baseURL)

  // Endpoint-driven formatting
  if (endpointType === ENDPOINT_TYPE.OLLAMA_CHAT || endpointType === ENDPOINT_TYPE.OLLAMA_GENERATE) {
    return formatOllamaApiHost(baseURL)
  }
  if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
    return formatApiHost(baseURL, appendApiVersion, 'v1beta')
  }

  // Provider-driven formatting (for providers without endpoint type info)
  if (isOllamaProvider(provider)) return formatOllamaApiHost(baseURL)
  if (isGeminiProvider(provider)) return formatApiHost(baseURL, appendApiVersion, 'v1beta')

  // Providers that don't append API version
  const noVersionProviders = ['copilot', 'github', 'cherryai', 'perplexity', 'newapi', 'new-api', 'azure-openai']
  if (noVersionProviders.includes(provider.id) || noVersionProviders.includes(provider.presetProviderId ?? '')) {
    return formatApiHost(baseURL, false)
  }

  return formatApiHost(baseURL, appendApiVersion)
}

// ── SDK Config Building ──

type ConfigBuilderEntry = {
  match: (provider: Provider, aiSdkProviderId: AppProviderId) => boolean
  build: (ctx: BuilderContext) => ProviderConfig | Promise<ProviderConfig>
}

/** Endpoint priority: `model.endpointTypes[0]` > `provider.defaultChatEndpoint` > fallback. */
export async function providerToAiSdkConfig(provider: Provider, model: Model): Promise<ProviderConfig> {
  const { endpointType, baseUrl } = resolveEffectiveEndpoint(provider, model)

  const aiSdkProviderId = appProviderIds[resolveAiSdkProviderId(provider, endpointType)]

  const formattedBaseUrl = formatBaseURL(baseUrl, provider, endpointType)
  const { baseURL, endpoint } = routeToEndpoint(formattedBaseUrl)
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
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    // `google-vertex-anthropic` (Vertex on an anthropic-messages endpoint) must route here
    // too — `buildVertexConfig` branches on `isAnthropic`. Otherwise it falls through to the
    // generic builder, dropping project/location/googleCredentials and the publisher baseURL.
    { match: (_, id) => id === 'google-vertex' || id === 'google-vertex-anthropic', build: buildVertexConfig },
    // Match on the provider id, not the resolved aiSdkProviderId: the resolver upgrades the
    // default chat endpoint to the `cherryin-chat` variant, so `id === 'cherryin'` is never true
    // for the common path and the request would fall through to the generic builder, dropping the
    // relay-resolved anthropic/gemini baseURLs and the `/v1` segment. (Mirrors `cherryai`/`copilot`.)
    { match: (p) => p.id === SystemProviderIds.cherryin, build: buildCherryinConfig },
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
      includeUsage: ctx.actualProvider.apiFeatures.streamOptions,
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
  const authConfig = await providerService.getAuthConfig(ctx.actualProvider.id)
  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  // SDK treats `""` as a valid baseURL → every request hits `""/model/...`. Guard region too.
  // (Mirrors renderer-side fix for upstream #14425.)
  const baseURL = ctx.baseConfig.baseURL || undefined

  if (authConfig?.type === 'iam-aws') {
    const region = authConfig.region?.trim() || undefined
    return {
      ...base,
      providerSettings: {
        ...ctx.baseConfig,
        baseURL,
        region,
        ...(authConfig.accessKeyId && { accessKeyId: authConfig.accessKeyId }),
        ...(authConfig.secretAccessKey && { secretAccessKey: authConfig.secretAccessKey })
      }
    }
  }

  // API-key fallback. Region undefined so the SDK picks its own default, not a hardcode.
  return { ...base, providerSettings: { ...ctx.baseConfig, baseURL } }
}

/**
 * Vertex service-account credentials may arrive with either camelCase
 * (`privateKey`/`clientEmail`) or snake_case (`private_key`/`client_email`)
 * keys depending on how the JSON key file was stored. Normalize both shapes to
 * the camelCase form the Vertex SDK expects. Shared with the model-listing path
 * (`createVertexModelListRequest`).
 */
export function normalizeVertexCredentials(credentials: Record<string, unknown> | undefined): {
  privateKey?: string
  clientEmail?: string
} {
  if (!credentials) return {}
  const privateKey = (credentials.privateKey ?? credentials.private_key) as string | undefined
  const clientEmail = (credentials.clientEmail ?? credentials.client_email) as string | undefined
  return {
    ...(privateKey !== undefined && { privateKey }),
    ...(clientEmail !== undefined && { clientEmail })
  }
}

async function buildVertexConfig(ctx: BuilderContext): Promise<ProviderConfig<'google-vertex'>> {
  const authConfig = await providerService.getAuthConfig(ctx.actualProvider.id)

  if (authConfig?.type !== 'iam-gcp') {
    throw new Error('VertexAI requires iam-gcp auth configuration.')
  }

  const { project, location, credentials } = authConfig
  const googleCredentials = credentials as Record<string, string> | undefined

  const modelId = ctx.model.apiModelId ?? ctx.model.id
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic' || modelId.startsWith('claude')
  // Standard Vertex providers leave baseURL empty. Appending the publisher suffix to `''`
  // yields a truthy host-less URL (`/publishers/google`), which the Vertex SDK's `?? ` default
  // does NOT override — so it must stay `undefined` to let the SDK derive the full aiplatform
  // host. Only append the suffix when a custom host is actually configured.
  const baseURL = ctx.baseConfig.baseURL
    ? ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')
    : undefined

  const { privateKey, clientEmail } = normalizeVertexCredentials(googleCredentials)
  const creds = googleCredentials
    ? { ...googleCredentials, clientEmail, privateKey: formatPrivateKey(privateKey ?? '') }
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
      return 'openai'
  }
}

async function buildCherryinConfig(ctx: BuilderContext): Promise<ProviderConfig> {
  let anthropicBaseURL: string | undefined
  let geminiBaseURL: string | undefined
  try {
    const cherryinProvider = await providerService.getByProviderId(SystemProviderIds.cherryin)
    anthropicBaseURL = formatApiHost(cherryinProvider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl)
    geminiBaseURL = formatApiHost(getBaseUrl(cherryinProvider, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT), true, 'v1beta')
  } catch {
    // CherryIn provider may not exist
  }

  const endpointType = ctx.model.endpointTypes?.[0]
  const cherryinEndpointType = mapCherryinEndpointType(endpointType)

  return {
    providerId: ctx.aiSdkProviderId,
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

function buildAzureConfig(
  ctx: BuilderContext
): ProviderConfig<'azure'> | ProviderConfig<'azure-anthropic'> | ProviderConfig<'azure-responses'> {
  const modelId = ctx.model.apiModelId ?? ctx.model.id
  const endpointType = ctx.model.endpointTypes?.[0]

  // Azure + Claude model → azure-anthropic
  if (modelId.startsWith('claude') || endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    return {
      providerId: 'azure-anthropic',
      endpoint: ctx.endpoint,
      providerSettings: {
        ...ctx.baseConfig,
        baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, true),
        headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
      }
    }
  }

  const apiVersion = ctx.actualProvider.settings?.apiVersion?.trim()
  const isResponsesVariant = ctx.aiSdkProviderId === 'azure-responses'

  const providerSettings: AppProviderSettingsMap['azure'] & {
    apiVersion?: string
    useDeploymentBasedUrls?: boolean
  } = {
    ...ctx.baseConfig,
    baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, false),
    headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
  }

  if (apiVersion) {
    providerSettings.apiVersion = apiVersion
    if (!isResponsesVariant) {
      providerSettings.useDeploymentBasedUrls = true
    }
  }

  if (isResponsesVariant) {
    return {
      providerId: 'azure-responses',
      endpoint: ctx.endpoint,
      providerSettings
    }
  }

  return {
    providerId: 'azure',
    endpoint: ctx.endpoint,
    providerSettings
  }
}

function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      ...commonOptions,
      name: ctx.actualProvider.id,
      includeUsage: ctx.actualProvider.apiFeatures.streamOptions
    }
  }
}

function buildGenericProviderConfig(ctx: BuilderContext): ProviderConfig {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: ctx.aiSdkProviderId,
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

/** NewAPI forwards to different upstream SDKs; per-endpoint suffix rules. */
function formatNewApiBaseURL(baseURL: string, endpointType: EndpointType | undefined): string {
  switch (endpointType) {
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return formatApiHost(baseURL, true, 'v1beta')
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return formatApiHost(baseURL, false)
    default:
      return formatApiHost(baseURL, true)
  }
}

function buildNewApiConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  const endpointType = ctx.model.endpointTypes?.[0]
  const baseURL = formatNewApiBaseURL(ctx.baseConfig.baseURL, endpointType)

  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      endpointType: mapCherryinEndpointType(endpointType),
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}
