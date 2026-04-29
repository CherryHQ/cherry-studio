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
  isVertexProvider,
  isVolcengineResponsesEndpointModel
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
    {
      match: (p) => isVolcengineResponsesEndpointModel(p, model),
      build: buildVolcengineResponsesConfig
    },
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VOLCENGINE_RESPONSES_UNSUPPORTED_FIELDS = [
  'conversation',
  'include',
  'metadata',
  'parallel_tool_calls',
  'prompt_cache_key',
  'prompt_cache_retention',
  'safety_identifier',
  'service_tier',
  'top_logprobs',
  'truncation'
] as const

type VolcengineResponsesSanitizeResult = {
  body: unknown
  changed: boolean
}

function sanitizeVolcengineResponsesTool(tool: unknown): VolcengineResponsesSanitizeResult {
  if (!isRecord(tool) || tool.type !== 'web_search') {
    return { body: tool, changed: false }
  }

  if (Object.keys(tool).length === 1) {
    return { body: tool, changed: false }
  }

  return { body: { type: 'web_search' }, changed: true }
}

function sanitizeVolcengineResponsesInputItem(inputItem: unknown): VolcengineResponsesSanitizeResult {
  if (!isRecord(inputItem) || !inputItem.role) {
    return { body: inputItem, changed: false }
  }

  const needsType = inputItem.type == null
  const needsStatus = inputItem.role === 'assistant' && !inputItem.status

  if (!needsType && !needsStatus) {
    return { body: inputItem, changed: false }
  }

  const sanitized: Record<string, any> = {
    ...inputItem
  }

  if (needsType) {
    sanitized.type = 'message'
  }

  if (needsStatus) {
    sanitized.status = 'completed'
  }

  return { body: sanitized, changed: true }
}

function sanitizeVolcengineResponsesBody(body: unknown): VolcengineResponsesSanitizeResult {
  if (!isRecord(body)) {
    return { body, changed: false }
  }

  let sanitized: Record<string, any> | undefined

  const getSanitized = () => {
    sanitized ??= { ...body }
    return sanitized
  }

  for (const field of VOLCENGINE_RESPONSES_UNSUPPORTED_FIELDS) {
    if (Object.hasOwn(body, field)) {
      delete getSanitized()[field]
    }
  }

  if (Array.isArray(body.tools)) {
    let toolsChanged = false
    const tools = body.tools.map((tool) => {
      const result = sanitizeVolcengineResponsesTool(tool)
      toolsChanged ||= result.changed
      return result.body
    })

    if (toolsChanged) {
      getSanitized().tools = tools
    }
  }

  if (Array.isArray(body.input)) {
    let inputChanged = false
    const input = body.input.map((inputItem) => {
      const result = sanitizeVolcengineResponsesInputItem(inputItem)
      inputChanged ||= result.changed
      return result.body
    })

    if (inputChanged) {
      getSanitized().input = input
    }
  }

  return {
    body: sanitized ?? body,
    changed: sanitized !== undefined
  }
}

function sanitizeVolcengineResponsesRequestInit(init?: RequestInit): RequestInit | undefined {
  if (typeof init?.body !== 'string') {
    return init
  }

  try {
    const result = sanitizeVolcengineResponsesBody(JSON.parse(init.body))
    if (!result.changed) {
      return init
    }

    return {
      ...init,
      body: JSON.stringify(result.body)
    }
  } catch {
    return init
  }
}

function normalizeVolcengineResponsesCitationAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeVolcengineResponsesCitationAnnotations)
  }

  if (!isRecord(value)) {
    return value
  }

  const normalized = { ...value }

  if (
    normalized.type === 'url_citation' &&
    typeof normalized.url === 'string' &&
    typeof normalized.title === 'string'
  ) {
    if (typeof normalized.start_index !== 'number') {
      normalized.start_index = 0
    }
    if (typeof normalized.end_index !== 'number') {
      normalized.end_index = 0
    }
  }

  for (const key of Object.keys(normalized)) {
    normalized[key] = normalizeVolcengineResponsesCitationAnnotations(normalized[key])
  }

  return normalized
}

function normalizeVolcengineResponsesSseDataLine(line: string): string {
  if (!line.startsWith('data:')) {
    return line
  }

  const data = line.slice('data:'.length)
  const leadingSpace = data.startsWith(' ') ? ' ' : ''
  const payload = leadingSpace ? data.slice(1) : data

  if (payload.trim() === '[DONE]' || payload.trim() === '') {
    return line
  }

  try {
    const normalized = normalizeVolcengineResponsesCitationAnnotations(JSON.parse(payload))
    return `data:${leadingSpace}${JSON.stringify(normalized)}`
  } catch {
    return line
  }
}

function normalizeVolcengineResponsesSseFrame(frame: string): string {
  return frame.split(/\r?\n/).map(normalizeVolcengineResponsesSseDataLine).join('\n')
}

function normalizeVolcengineResponsesSseStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = stream.getReader()

      const read = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              buffer += decoder.decode()
              if (buffer) {
                controller.enqueue(encoder.encode(normalizeVolcengineResponsesSseFrame(buffer)))
              }
              controller.close()
              return
            }

            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split(/\r?\n\r?\n/)
            buffer = frames.pop() ?? ''

            for (const frame of frames) {
              controller.enqueue(encoder.encode(`${normalizeVolcengineResponsesSseFrame(frame)}\n\n`))
            }

            read()
          })
          .catch((error) => controller.error(error))
      }

      read()
    }
  })
}

function normalizeVolcengineResponsesResponse(response: Response): Response {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    return response
  }

  return new Response(normalizeVolcengineResponsesSseStream(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
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

function buildVolcengineResponsesConfig(ctx: BuilderContext): ProviderConfig<'openai'> {
  const commonOptions = buildCommonOptions(ctx)

  return {
    providerId: 'openai',
    endpoint: ctx.endpoint,
    providerSettings: {
      ...ctx.baseConfig,
      ...commonOptions,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
        normalizeVolcengineResponsesResponse(await fetch(input, sanitizeVolcengineResponsesRequestInit(init)))
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
