/**
 * `Provider + Model` → `ProviderConfig` for `@cherrystudio/ai-core`.
 * Always async because `providerService.getRotatedApiKey` is async.
 */

import { application } from '@application'
import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import { providerService } from '@main/data/services/ProviderService'
import { copilotService } from '@main/services/CopilotService'
import { defaultAppHeaders } from '@main/utils/http'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import { GROK_CLI_PROVIDER_ID } from '@shared/data/presets/grokCli'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { EndpointType, Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, formatOllamaApiHost, isWithTrailingSharp } from '@shared/utils/api'
import { isGenerateImageModel } from '@shared/utils/model'
import { isAzureOpenAIProvider, isGeminiProvider, isOllamaProvider, matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import { isEmpty } from 'es-toolkit/compat'

import type { ProviderConfig } from '../types'
import { type AppProviderId, appProviderIds, type AppProviderSettingsMap } from '../types'
import { customFetch } from '../utils/customFetch'
import { getBaseUrl, getExtraHeaders, routeToEndpoint } from '../utils/provider'
import { generateSignature } from './cherryai'
import { buildCodexRequestHeaders, coerceCodexRequestBody } from './codex'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import { dmxapiUsesCustomTransport } from './custom/dmxapi/dmxapiProvider'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint } from './endpoint'
import { buildGrokCliRequestHeaders, rewriteGrokCliResponsesBody } from './grokCli'
import { isVertexMaasModelId, normalizeVertexCredentials } from './vertex'

interface BaseConfig {
  baseURL: string
  apiKey: string
}

interface BuilderContext {
  actualProvider: Provider
  model: Model
  baseConfig: BaseConfig
  endpointType?: EndpointType
  endpoint?: string
  aiSdkProviderId: StringKeys<AppProviderSettingsMap>
}

interface ProviderToAiSdkConfigOptions {
  apiKeyOverride?: string
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
  const noVersionProviders = [
    'copilot',
    'github',
    CHERRYAI_PROVIDER_ID,
    'perplexity',
    'newapi',
    'new-api',
    'azure-openai'
  ]
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
export async function providerToAiSdkConfig(
  provider: Provider,
  model: Model,
  options?: ProviderToAiSdkConfigOptions
): Promise<ProviderConfig> {
  const { endpointType, baseUrl } = resolveEffectiveEndpoint(provider, model)

  const aiSdkProviderId = appProviderIds[resolveAiSdkProviderId(provider, endpointType)]

  const formattedBaseUrl = formatBaseURL(baseUrl, provider, endpointType)
  const { baseURL, endpoint } = routeToEndpoint(formattedBaseUrl)
  const apiKey = options?.apiKeyOverride ?? providerService.getRotatedApiKey(provider.id)

  const ctx: BuilderContext = {
    actualProvider: provider,
    model,
    baseConfig: { baseURL, apiKey },
    endpointType,
    endpoint,
    aiSdkProviderId
  }

  const builders: ConfigBuilderEntry[] = [
    { match: (p) => p.id === SystemProviderIds.copilot, build: buildCopilotConfig },
    { match: (p) => p.id === OPENAI_CODEX_PROVIDER_ID, build: buildCodexConfig },
    { match: (p) => p.id === GROK_CLI_PROVIDER_ID, build: buildGrokCliConfig },
    { match: (p) => p.id === CHERRYAI_PROVIDER_ID, build: buildCherryAIConfig },
    // Local embedding runs fully in-process (transformers.js in a worker): no
    // endpoint, baseURL, or apiKey. Without this entry it falls through to the
    // openai-compatible builder, which hands ai-core an empty baseURL and throws
    // "Invalid URL". Route it to its own registered provider so embed calls reach
    // LocalEmbeddingModel.doEmbed directly.
    {
      match: (p) => p.id === LOCAL_EMBEDDING_PROVIDER_ID,
      build: (ctx) => ({ providerId: LOCAL_EMBEDDING_PROVIDER_ID, endpoint: ctx.endpoint, providerSettings: {} })
    },
    { match: (p) => isOllamaProvider(p), build: buildOllamaConfig },
    { match: (p) => isAzureOpenAIProvider(p), build: buildAzureConfig },
    // DashScope chat is OpenAI-compatible, but Bailian rerank uses a provider-specific URL.
    // Only replace the OpenAI-compatible branch so other DashScope endpoint families stay routed normally.
    {
      match: (p, id) => p.id === SystemProviderIds.dashscope && id === 'openai-compatible',
      build: buildDashScopeConfig
    },
    // modelscope / ppio / dmxapi: chat & embedding are OpenAI-compatible, but IMAGE
    // generation needs the bespoke submit/poll transport inside the extension provider
    // (createXProvider().imageModel()). Override the resolved `openai-compatible` id to
    // the extension id for image models only — chat/embedding fall through to the generic
    // openai-compatible builder (which keeps `includeUsage`). provider.id is the extension
    // id here, since the match requires it.
    {
      match: (p, id) =>
        id === 'openai-compatible' &&
        isGenerateImageModel(model) &&
        (p.id === SystemProviderIds.modelscope ||
          p.id === SystemProviderIds.ppio ||
          p.id === SystemProviderIds.silicon ||
          (p.id === SystemProviderIds.dmxapi && dmxapiUsesCustomTransport(model.apiModelId ?? model.id))),
      // provider.id is guaranteed to be one of these by the match above.
      build: (ctx) => ({
        providerId: ctx.actualProvider.id as 'modelscope' | 'ppio' | 'silicon' | 'dmxapi',
        endpoint: ctx.endpoint,
        providerSettings: {
          ...ctx.baseConfig,
          headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
        }
      })
    },
    { match: (_, id) => id === 'bedrock', build: buildBedrockConfig },
    // `google-vertex-anthropic` (Vertex on an anthropic-messages endpoint) must route here
    // too — `buildVertexConfig` branches on `isAnthropic`. Otherwise it falls through to the
    // generic builder, dropping project/location/googleCredentials and the publisher baseURL.
    { match: (_, id) => id === 'google-vertex' || id === 'google-vertex-anthropic', build: buildVertexConfig },
    { match: (p) => matchesPreset(p, SystemProviderIds.cherryin), build: buildCherryinConfig },
    { match: (_, id) => id === 'newapi', build: buildNewApiConfig },
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig },
    { match: (_, id) => id === 'dmxapi', build: buildDmxapiConfig }
  ]

  const builder = builders.find((b) => b.match(provider, aiSdkProviderId))
  let config: ProviderConfig
  if (builder) {
    config = await builder.build(ctx)
  } else if (hasProviderConfig(aiSdkProviderId) && aiSdkProviderId !== 'openai-compatible') {
    config = buildGenericProviderConfig(ctx)
  } else {
    config = buildOpenAICompatibleConfig(ctx)
  }

  // Default every provider to the proxy-aware net.fetch base so the app proxy
  // (ProxyService → session.setProxy) applies to provider HTTP traffic. Builders
  // that install their own fetch wrapper (e.g. CherryAI request signing) compose
  // on top of customFetch; `??=` preserves them rather than clobbering them.
  config.providerSettings.fetch ??= customFetch

  return config
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

/**
 * OpenAI Codex routes through the standard OpenAI Responses adapter, but against
 * the ChatGPT backend codex endpoint (`…/backend-api/codex/responses`, no `/v1`
 * segment) with OAuth bearer auth instead of an API key. The per-request `fetch`
 * is the single place that (1) injects a freshly-refreshed OAuth token + account
 * header, and (2) coerces the body to what the codex backend demands —
 * `store: false` plus encrypted-reasoning round-tripping — neither of which the
 * generic Responses adapter sets on its own.
 */
function buildCodexConfig(ctx: BuilderContext): ProviderConfig<'openai'> {
  // Use the raw configured baseURL (the adapter appends `/responses`); the
  // formatted one in baseConfig has `/v1` tacked on, which the codex path rejects.
  const rawBaseUrl =
    getBaseUrl(ctx.actualProvider, ENDPOINT_TYPE.OPENAI_RESPONSES) || 'https://chatgpt.com/backend-api/codex'
  const baseURL = rawBaseUrl.replace(/\/+$/, '')

  return {
    providerId: 'openai',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      // The SDK rejects an empty key; the real bearer token is injected per
      // request in the custom fetch below, overriding this placeholder.
      apiKey: 'codex-oauth',
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) },
      fetch: buildCodexFetch()
    }
  }
}

function buildCodexFetch() {
  // Token fetch + not-signed-in guard + 401 force-refresh retry live in
  // OAuthRuntimeService.authenticatedFetch; this wrapper only shapes the codex
  // request (headers + body coercion), re-applied with the fresh token on retry.
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    application.get('OAuthRuntimeService').authenticatedFetch(
      OPENAI_CODEX_PROVIDER_ID,
      (creds) => ({
        input,
        init: {
          ...init,
          headers: buildCodexRequestHeaders(init?.headers, {
            accessToken: creds.accessToken,
            accountId: creds.accountId ?? null
          }),
          body: coerceCodexRequestBody(init?.body)
        }
      }),
      customFetch,
      { notSignedInMessage: 'Not signed in to OpenAI Codex. Open the provider settings and sign in again.' }
    )
}

/**
 * Grok CLI routes through the OpenAI Responses adapter against xAI's Grok CLI
 * proxy (`cli-chat-proxy.grok.com/v1/responses`) with OAuth bearer auth. The
 * per-request `fetch` injects a freshly-refreshed token + the Grok-CLI proxy
 * headers, and rewrites the body into the shape the proxy accepts (hoisting
 * system turns into `instructions`, dropping reasoning knobs) — none of which
 * the generic Responses adapter does on its own.
 */
function buildGrokCliConfig(ctx: BuilderContext): ProviderConfig<'openai'> {
  // Use the raw configured baseURL (already `…/v1`; the adapter appends
  // `/responses`); the formatted one in baseConfig would double the `/v1`.
  const rawBaseUrl =
    getBaseUrl(ctx.actualProvider, ENDPOINT_TYPE.OPENAI_RESPONSES) || 'https://cli-chat-proxy.grok.com/v1'
  const baseURL = rawBaseUrl.replace(/\/+$/, '')

  return {
    providerId: 'openai',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      // The SDK rejects an empty key; the real bearer token is injected per
      // request in the custom fetch below, overriding this placeholder.
      apiKey: 'grok-cli-oauth',
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) },
      fetch: buildGrokCliFetch()
    }
  }
}

function buildGrokCliFetch() {
  // See buildCodexFetch: shared token/refresh/401-retry lives in
  // OAuthRuntimeService.authenticatedFetch; this only shapes the Grok request.
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let modelId = ''
    let body = init?.body
    if (typeof body === 'string') {
      try {
        const json = JSON.parse(body)
        modelId = typeof json.model === 'string' ? json.model : ''
        body = JSON.stringify(rewriteGrokCliResponsesBody(json))
      } catch {
        // Non-JSON body (shouldn't happen for responses) — leave untouched.
      }
    }

    return application.get('OAuthRuntimeService').authenticatedFetch(
      GROK_CLI_PROVIDER_ID,
      (creds) => ({
        input,
        init: {
          ...init,
          headers: buildGrokCliRequestHeaders(init?.headers, { accessToken: creds.accessToken, modelId }),
          body
        }
      }),
      customFetch,
      { notSignedInMessage: 'Not signed in to Grok CLI. Open the provider settings and sign in again.' }
    )
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
        return customFetch(input, { ...init, headers: { ...init?.headers, ...signature } })
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

function buildBedrockConfig(ctx: BuilderContext): ProviderConfig<'bedrock'> {
  const authConfig = providerService.getAuthConfig(ctx.actualProvider.id)
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

function buildVertexConfig(
  ctx: BuilderContext
): ProviderConfig<'google-vertex'> | ProviderConfig<'google-vertex-maas'> {
  const authConfig = providerService.getAuthConfig(ctx.actualProvider.id)

  if (authConfig?.type !== 'iam-gcp') {
    throw new Error('VertexAI requires iam-gcp auth configuration.')
  }

  const { project, location, credentials } = authConfig
  const googleCredentials = credentials as Record<string, string> | undefined

  const { privateKey, clientEmail } = normalizeVertexCredentials(googleCredentials)
  const creds = googleCredentials
    ? { ...googleCredentials, clientEmail, privateKey: formatPrivateKey(privateKey ?? '') }
    : undefined

  const modelId = ctx.model.apiModelId ?? ctx.model.id
  const isAnthropic = ctx.aiSdkProviderId === 'google-vertex-anthropic' || modelId.startsWith('claude')

  // MaaS open/partner models (Llama, DeepSeek, Qwen, GLM, Kimi, gpt-oss) are served over
  // Vertex's OpenAI-compatible Chat Completions endpoint, not the Gemini generateContent
  // SDK that `google-vertex` uses. They carry a `{publisher}/{model}` id — the model listing
  // bakes the publisher prefix in (§listModels/vertex), and that same id is the `model` the
  // OpenAI-compatible endpoint expects. Route them to the dedicated MaaS adapter, which mints
  // the GCP bearer token itself from the iam-gcp credentials.
  // Manually-added MaaS models must use the same `publisher/model-maas` form as listed models.
  if (!isAnthropic && isVertexMaasModelId(modelId)) {
    return {
      providerId: 'google-vertex-maas',
      endpoint: ctx.endpoint,
      providerSettings: {
        project,
        location,
        // Standard providers leave baseURL empty so the adapter derives the aiplatform host
        // from project+location; a custom host (proxy) passes through untouched.
        ...(ctx.baseConfig.baseURL && { baseURL: ctx.baseConfig.baseURL }),
        ...(creds && { googleCredentials: creds }),
        headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
      }
    } as ProviderConfig<'google-vertex-maas'>
  }

  // Standard Vertex providers leave baseURL empty. Appending the publisher suffix to `''`
  // yields a truthy host-less URL (`/publishers/google`), which the Vertex SDK's `?? ` default
  // does NOT override — so it must stay `undefined` to let the SDK derive the full aiplatform
  // host. Only append the suffix when a custom host is actually configured.
  const baseURL = ctx.baseConfig.baseURL
    ? ctx.baseConfig.baseURL + (isAnthropic ? '/publishers/anthropic/models' : '/publishers/google')
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

function buildCherryinConfig(ctx: BuilderContext): ProviderConfig {
  const provider = ctx.actualProvider
  const anthropicBaseURL = formatApiHost(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl)
  const geminiBaseURL = formatApiHost(getBaseUrl(provider, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT), true, 'v1beta')

  const cherryinEndpointType = mapCherryinEndpointType(ctx.endpointType)

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
  const endpointType = ctx.endpointType

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
  const { baseURL, endpoint } = routeToEndpoint(
    formatBaseURL(
      getBaseUrl(ctx.actualProvider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS),
      ctx.actualProvider,
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
  )
  return {
    providerId: 'aihubmix',
    endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}

function buildDmxapiConfig(ctx: BuilderContext): ProviderConfig<'dmxapi'> {
  const { baseURL, endpoint } = routeToEndpoint(
    formatBaseURL(
      getBaseUrl(ctx.actualProvider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS),
      ctx.actualProvider,
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
  )
  return {
    providerId: 'dmxapi',
    endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      baseURL,
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) }
    }
  }
}

function buildDashScopeConfig(ctx: BuilderContext): ProviderConfig<'dashscope'> {
  return {
    providerId: 'dashscope',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      headers: { ...defaultAppHeaders(), ...getExtraHeaders(ctx.actualProvider) },
      includeUsage: ctx.actualProvider.apiFeatures.streamOptions
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
  const endpointType = ctx.endpointType
  let rawBaseURL: string

  if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
    const anthropicBaseURL = getBaseUrl(ctx.actualProvider, endpointType)
    rawBaseURL = anthropicBaseURL || ctx.baseConfig.baseURL
  } else {
    rawBaseURL = ctx.baseConfig.baseURL
  }

  const baseURL = formatNewApiBaseURL(rawBaseURL, endpointType)

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
