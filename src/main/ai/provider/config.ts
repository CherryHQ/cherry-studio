/**
 * Provider configuration builder — v2 DataApi types.
 *
 * Converts v2 Provider + Model into ProviderConfig for @cherrystudio/ai-core.
 * API key resolved via providerService.getRotatedApiKey() (async).
 * Auth config via providerService.getAuthConfig() for IAM providers.
 */

import { formatPrivateKey, hasProviderConfig, type StringKeys } from '@cherrystudio/ai-core/provider'
import type { CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { providerService } from '@main/data/services/ProviderService'
import { generateSignature } from '@main/integration/cherryai'
import { sessionService } from '@main/services/agents'
import { anthropicService } from '@main/services/AnthropicService'
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
import {
  buildClaudeCodeSessionSettings,
  buildSpawnProcess,
  resolveClaudeExecutablePath
} from './claudeCodeSettingsBuilder'
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
  /** Agent session ID — when provided, claude-code builder looks up session and merges settings. */
  agentSessionId?: string
}

/**
 * Format a raw base URL for API calls.
 * Applies provider-specific formatting (API version, Ollama/Gemini paths, etc.)
 * align ai sdk
 */
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

/**
 * Build AI SDK provider config from v2 Provider + Model.
 * Always async (getRotatedApiKey is async).
 *
 * Endpoint routing: model.endpointTypes[0] > provider.defaultChatEndpoint > fallback.
 * Provider variant selected by resolveProviderVariant based on endpoint type.
 */
export async function providerToAiSdkConfig(
  provider: Provider,
  model: Model,
  options?: { agentSessionId?: string }
): Promise<ProviderConfig> {
  const { endpointType, baseUrl } = resolveEffectiveEndpoint(provider, model)

  const aiSdkProviderId = options?.agentSessionId
    ? appProviderIds['claude-code']
    : appProviderIds[resolveAiSdkProviderId(provider, endpointType)]

  const formattedBaseUrl = formatBaseURL(baseUrl, provider, endpointType)
  const { baseURL, endpoint } = routeToEndpoint(formattedBaseUrl)
  const apiKey = await providerService.getRotatedApiKey(provider.id)

  const ctx: BuilderContext = {
    actualProvider: provider,
    model,
    baseConfig: { baseURL, apiKey },
    endpoint,
    aiSdkProviderId,
    agentSessionId: options?.agentSessionId
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
    { match: (_, id) => id === 'aihubmix', build: buildAiHubMixConfig },
    { match: (_, id) => id === 'claude-code', build: buildClaudeCodeConfig }
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
  const authConfig = await providerService.getAuthConfig(ctx.actualProvider.id)
  const base = { providerId: 'bedrock' as const, endpoint: ctx.endpoint }

  // Prevent empty string slipping through to `@ai-sdk/amazon-bedrock`:
  //   the SDK uses `options.baseURL != null ? options.baseURL : derivedFromRegion`
  //   so `""` is treated as a *valid* base URL and every request hits `""/model/...`.
  //   Same guard for region — empty → malformed `https://bedrock-runtime..amazonaws.com`.
  //   (Upstream #14425 — hotfix for the renderer-side equivalent.)
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

  // Fallback: API key auth. Region left undefined so SDK falls back to
  // `us-east-1` on its own — we don't hardcode it, so users aren't silently
  // forced into the wrong region.
  return { ...base, providerSettings: { ...ctx.baseConfig, baseURL } }
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
    // Variant already resolved by resolveProviderVariant in providerToAiSdkConfig
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
    // Variant (azure vs azure-responses) already resolved by resolveProviderVariant
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
    providerSettings: { ...ctx.baseConfig, ...commonOptions, name: ctx.actualProvider.id }
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

/**
 * Claude Code provider — wraps Claude Agent SDK as a standard AI SDK provider.
 *
 * Without agentSession: provider-level defaults (exe path, spawn, env vars).
 * With agentSession: full session settings (cwd, MCP, tools, prompts) via
 * buildClaudeCodeSessionSettings — replaces provider-level defaults entirely.
 */
async function buildClaudeCodeConfig(ctx: BuilderContext): Promise<ProviderConfig<'claude-code'>> {
  // Claude Code SDK uses Anthropic Messages API internally (via @anthropic-ai SDK).
  // The SDK manages API versioning — ANTHROPIC_BASE_URL should NOT include /v1.
  // Prefer the provider's anthropic-messages endpoint if configured.
  const anthropicEndpointUrl = ctx.actualProvider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const rawBaseUrl = anthropicEndpointUrl || ctx.baseConfig.baseURL
  const anthropicBaseUrl = rawBaseUrl ? formatApiHost(rawBaseUrl, false) : undefined

  // Agent session: full session settings from DB
  if (ctx.agentSessionId) {
    const session = await sessionService.getById(ctx.agentSessionId)
    if (!session) throw new Error(`Agent session not found: ${ctx.agentSessionId}`)

    // Look up last SDK session ID for resume (survives app restart). The
    // service returns `string | null` (no upstream session); the builder
    // expects optional string, so coerce null → undefined here.
    const lastAgentSessionId = (await agentSessionMessageService.getLastAgentSessionId(ctx.agentSessionId)) ?? undefined
    const sessionSettings = await buildClaudeCodeSessionSettings(session, ctx.actualProvider, { lastAgentSessionId })

    return {
      providerId: 'claude-code',
      providerSettings: {
        apiKey: ctx.baseConfig.apiKey,
        baseURL: anthropicBaseUrl,
        defaultSettings: sessionSettings
      }
    }
  }

  // No session: provider-level defaults only
  return {
    providerId: 'claude-code',
    providerSettings: {
      apiKey: ctx.baseConfig.apiKey,
      baseURL: anthropicBaseUrl,
      defaultSettings: {
        pathToClaudeCodeExecutable: resolveClaudeExecutablePath(),
        spawnClaudeCodeProcess: buildSpawnProcess()
      }
    }
  }
}

/**
 * NewAPI baseURL varies by endpoint protocol because the proxy forwards
 * requests to different upstream SDKs:
 *   - Gemini  → needs `/v1beta` suffix (matches Google GenAI SDK expectation)
 *   - Anthropic → no `/v1` suffix (the Anthropic SDK adds it internally)
 *   - OpenAI and friends → `/v1`
 */
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
