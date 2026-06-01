import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { AppProviderId, AppProviderSettingsMap } from '@renderer/aiCore/types'
import {
  getAwsBedrockAccessKeyId,
  getAwsBedrockApiKey,
  getAwsBedrockAuthType,
  getAwsBedrockRegion,
  getAwsBedrockSecretAccessKey
} from '@renderer/hooks/useAwsBedrock'
import { createVertexProvider, isVertexAiConfigured } from '@renderer/hooks/useVertexAi'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getProviderById } from '@renderer/services/ProviderService'
import store from '@renderer/store'
import { type Model, type Provider, SystemProviderIds } from '@renderer/types'
import {
  formatApiHost,
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
import { DEFAULT_DASHSCOPE_IMAGE_BASE_URL } from './custom/dashscope/dashscopeTransport'
import { DEFAULT_DMXAPI_BASE_URL } from './custom/dmxapi/dmxapiTransport'
import { DEFAULT_OVMS_BASE_URL } from './custom/ovms/ovmsTransport'
import { DEFAULT_PPIO_BASE_URL } from './custom/ppio/ppioTransport'
import { getAiSdkProviderId } from './factory'

// === Types ===

interface BaseConfig {
  baseURL: string
  apiKey: string
}

/**
 * Derive the native image-API origin from a user-configured chat baseURL by
 * stripping the trailing OpenAI-compat path segment. Providers that serve BOTH
 * OpenAI-compat chat (under `/v1/`, `/compatible-mode/v1/`, `/openai/v1/`) and
 * a native image API at the host root call this so the user only configures
 * one baseURL (the chat one) and the painting transport reaches the right host
 * without duplicating the path segment.
 *
 * Examples:
 *   - DMXAPI:    `https://www.dmxapi.cn/v1/`               → `https://www.dmxapi.cn`
 *   - DashScope: `https://dashscope.aliyuncs.com/compatible-mode/v1/` → `https://dashscope.aliyuncs.com`
 *   - Proxy:     `https://proxy.example.com/dashscope/compatible-mode/v1` → `https://proxy.example.com/dashscope`
 *   - Already root: `https://www.dmxapi.cn` → unchanged
 */
function deriveImageBaseURL(chatBaseURL: string, fallback: string): string {
  if (!chatBaseURL) return fallback
  const stripped = chatBaseURL.replace(/\/(?:compatible-mode\/v1|openai\/v1|v1)\/?$/, '')
  return stripped || fallback
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
    { match: isAzureOpenAIProvider, format: (p) => formatApiHost(p.apiHost, false) },
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
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    { match: (_, id) => id === 'google-vertex', build: buildVertexConfig },
    { match: (_, id) => id === 'cherryin', build: buildCherryinConfig },
    { match: (_, id) => id === 'newapi', build: buildNewApiConfig },
    { match: (p) => p.id === 'aionly', build: buildAionlyConfig },
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig },
    { match: (_, id) => id === 'ppio', build: buildPpioConfig },
    { match: (_, id) => id === 'silicon', build: buildSiliconConfig },
    { match: (_, id) => id === 'zhipu', build: buildZhipuConfig },
    { match: (_, id) => id === 'dashscope', build: buildDashScopeConfig },
    { match: (p) => p.id === 'dmxapi', build: buildDmxapiConfig },
    { match: (p) => p.id === 'ovms', build: buildOvmsConfig }
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
  const region = getAwsBedrockRegion().trim() || undefined

  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  const baseURL = ctx.baseConfig.baseURL || undefined

  if (authType === 'apiKey') {
    return { ...base, providerSettings: { ...ctx.baseConfig, baseURL, region, apiKey: getAwsBedrockApiKey() } }
  }
  return {
    ...base,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      region,
      accessKeyId: getAwsBedrockAccessKeyId(),
      secretAccessKey: getAwsBedrockSecretAccessKey()
    }
  }
}

function buildVertexConfig(
  ctx: BuilderContext
): ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-anthropic'> {
  if (!isVertexAiConfigured()) {
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
      geminiBaseURL: cherryinProvider ? cherryinProvider.apiHost + '/v1beta' : undefined,
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

function formatAzureBaseURL(baseURL: string, forAnthropic: boolean): string {
  // Normalize: strip trailing /v1 and /openai that user may have included
  const normalized = baseURL.replace(/\/v1$/, '').replace(/\/openai$/, '')
  // Azure OpenAI endpoints need /openai suffix; Azure Anthropic does not
  return forAnthropic ? normalized : normalized + '/openai'
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
        baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, true),
        headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
      }
    }
  }

  const apiVersion = ctx.actualProvider.apiVersion?.trim()
  const useResponsesMode = apiVersion && ['preview', 'v1'].includes(apiVersion)

  const providerSettings: ProviderConfig<'azure'>['providerSettings'] = {
    ...ctx.baseConfig,
    baseURL: formatAzureBaseURL(ctx.baseConfig.baseURL, false),
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

function buildOpenAICompatibleConfig(ctx: BuilderContext): ProviderConfig<'openai-compatible'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'openai-compatible',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      ...commonOptions,
      name: ctx.actualProvider.id,
      includeUsage
    }
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

function buildSiliconConfig(ctx: BuilderContext): ProviderConfig<'silicon'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'silicon',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions, includeUsage }
  }
}

function buildZhipuConfig(ctx: BuilderContext): ProviderConfig<'zhipu'> {
  const commonOptions = buildCommonOptions(ctx)
  const includeUsage = isSupportStreamOptionsProvider(ctx.actualProvider)
    ? store.getState().settings.openAI?.streamOptions?.includeUsage
    : undefined

  return {
    providerId: 'zhipu',
    endpoint: ctx.endpoint,
    providerSettings: { ...ctx.baseConfig, ...commonOptions, includeUsage }
  }
}

/**
 * DashScope (Bailian) serves chat (OpenAI-compatible at `/compatible-mode/v1/`)
 * and image (native DashScope at `/api/v1/services/aigc/*`) off ONE provider.
 * Chat keeps the user-configured baseURL verbatim; image strips the
 * `/compatible-mode/v1/?` suffix so the native endpoints resolve correctly
 * whether the user pointed at cn / intl / Frankfurt / a proxy. No region URL
 * is hardcoded — whatever the user typed wins.
 */
function buildDashScopeConfig(ctx: BuilderContext): ProviderConfig<'dashscope'> {
  const imageBaseURL = deriveImageBaseURL(ctx.baseConfig.baseURL, DEFAULT_DASHSCOPE_IMAGE_BASE_URL)
  return {
    providerId: 'dashscope',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      imageBaseURL,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

/**
 * PPIO serves BOTH chat and image off one ProviderV3, but the two endpoints
 * live on different hosts/paths:
 *   PPIO chat = `api.ppinfra.com/v3/openai`    image = `api.ppio.com`
 * `baseURL` carries the resolved chat `apiHost` for the OpenAICompatible
 * chat/embedding models; `imageBaseURL` carries the legacy pinned image host
 * that the polling transport uses — keeping the painting request URLs
 * byte-identical to the bespoke service while letting chat reach the right
 * endpoint.
 */
function buildPpioConfig(ctx: BuilderContext): ProviderConfig<'ppio'> {
  return {
    providerId: 'ppio',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      imageBaseURL: DEFAULT_PPIO_BASE_URL,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

/**
 * DMXAPI/OVMS providers serve chat + image off one ProviderV3. Unlike
 * PPIO (where the image host is pinned to a different domain),
 * DMXAPI's image host follows the user-configured `apiHost` (cross-platform
 * .com/.cn/enterprise), and OVMS is a local OpenVINO server where chat and
 * image share `localhost` (only path differs). `baseURL` carries the chat
 * apiHost; `imageBaseURL` mirrors it (with `DEFAULT_*` as empty-fallback) so
 * the polling transport keeps the same user override. OVMS carries no auth.
 */
function buildDmxapiConfig(ctx: BuilderContext): ProviderConfig<'dmxapi'> {
  return {
    providerId: 'dmxapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL: ctx.baseConfig.baseURL || DEFAULT_DMXAPI_BASE_URL,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

function buildOvmsConfig(ctx: BuilderContext): ProviderConfig<'ovms'> {
  return {
    providerId: 'ovms',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL: ctx.baseConfig.baseURL || DEFAULT_OVMS_BASE_URL,
      imageBaseURL: ctx.baseConfig.baseURL || DEFAULT_OVMS_BASE_URL
    }
  }
}

function formatNewApiBaseURL(baseURL: string, endpointType?: string): string {
  switch (endpointType) {
    case 'gemini':
      return formatApiHost(baseURL, true, 'v1beta')
    case 'anthropic':
      return formatApiHost(baseURL, false)
    default:
      return formatApiHost(baseURL, true)
  }
}

function buildNewApiConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  const baseURL = formatNewApiBaseURL(ctx.baseConfig.baseURL, ctx.model.endpoint_type)

  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      endpointType: ctx.model.endpoint_type,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}

/**
 * `aionly` reuses the `newapi` OpenAI-compatible image model but its images
 * endpoint lives under a `/openai/v1` path prefix. The legacy painting code
 * (`providers/newapi/generate.ts` `buildRequestUrls`) computed
 * `${apiHost.replace(/\/v1$/, '')}/openai/v1/images/{generations,edits}`.
 *
 * `ctx.baseConfig.baseURL` here is the already-formatted apiHost (via
 * `formatProviderApiHost` → `formatApiHost`, which appends `/v1` when absent),
 * and the `newapi` image model URL builder yields
 * `withoutTrailingSlash(baseURL) + '/images/{generations,edits}'`. Stripping a
 * trailing `/v1` then appending `/openai/v1` makes the final URL byte-identical
 * to the legacy URL for every well-formed apiHost.
 */
function buildAionlyConfig(ctx: BuilderContext): ProviderConfig<'newapi'> {
  const baseURL = `${ctx.baseConfig.baseURL.replace(/\/v1$/, '')}/openai/v1`

  return {
    providerId: 'newapi',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      endpointType: ctx.model.endpoint_type,
      headers: { ...defaultAppHeaders(), ...ctx.actualProvider.extra_headers }
    }
  }
}
