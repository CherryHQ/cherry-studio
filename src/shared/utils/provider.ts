import {
  isServerToolModelEligible as isRegistryServerToolModelEligible,
  isWebSearchEffortUnsupported,
  matchVendor,
  SERVER_TOOL,
  SERVER_TOOL_MODEL_SCOPE,
  type ServerTool,
  type ServerToolConfig,
  supportsServerToolFunctionMixing
} from '@cherrystudio/provider-registry'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { EndpointDialect, Provider } from '@shared/data/types/provider'

import { getLowerBaseModelName, getRawModelId, isFunctionCallingModel, isGeminiModel, isNonChatModel } from './model'
import { getProviderHostTopology } from './providerTopology'

// Azure/Vertex/Bedrock reuse other vendors' endpoint protocols, so authType
// is the only reliable discriminator (seeded skeletons may lack a distinct
// defaultChatEndpoint). See presetProviderSeeder.ts.
export function isVertexProvider(provider: Provider): boolean {
  return provider.authType === 'iam-gcp'
}

export function isAzureOpenAIProvider(provider: Provider): boolean {
  return provider.authType === 'iam-azure'
}

export function isAwsBedrockProvider(provider: Provider): boolean {
  return provider.authType === 'iam-aws' || provider.authType === 'api-key-aws'
}

export function isOllamaProvider(provider: Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint'>): boolean {
  return (
    provider.id === 'ollama' ||
    provider.presetProviderId === 'ollama' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OLLAMA_CHAT
  )
}

/**
 * Ollama's local server does not validate credentials, but the SDKs backing
 * Claude Code and OpenCode still require a non-empty auth token string — used
 * as a stand-in wherever an Ollama provider has no configured API key.
 */
export const OLLAMA_PLACEHOLDER_AUTH_TOKEN = 'ollama'

// `&& !iam-gcp` excludes Vertex, which the seeder gives the same
// google-generate-content endpoint as Gemini.
export function isGeminiProvider(provider: Provider): boolean {
  return (
    (provider.id === 'google' ||
      provider.id === 'gemini' ||
      provider.presetProviderId === 'gemini' ||
      provider.defaultChatEndpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) &&
    provider.authType !== 'iam-gcp'
  )
}

export function isAnthropicProvider(provider: Provider): boolean {
  return (
    provider.presetProviderId === 'anthropic' ||
    provider.id === 'anthropic' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  )
}

export function isOpenAIProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
}

export function isOpenAIChatProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

export function isOpenAIResponsesProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
}

export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return (
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES ||
    provider.presetProviderId === 'new-api' ||
    provider.presetProviderId === 'mistral'
  )
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity' || provider.presetProviderId === 'perplexity'
}

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === CHERRYAI_PROVIDER_ID || provider.presetProviderId === CHERRYAI_PROVIDER_ID
}

export function isNewApiProvider(provider: Provider): boolean {
  return matchesPreset(provider, 'new-api') || matchesPreset(provider, 'cherryin') || matchesPreset(provider, 'aionly')
}

export function isAIGatewayProvider(provider: Provider): boolean {
  return provider.presetProviderId === 'gateway' || provider.id === 'gateway'
}

export function isGeminiWebSearchProvider(provider: Provider): boolean {
  return isGeminiProvider(provider) || isVertexProvider(provider)
}

/**
 * Whether this host injects Google's NATIVE web tools for a Gemini model — the thing pre-3 Gemini
 * refuses to mix with function declarations. Direct Gemini/Vertex do; so do the gateways whose models
 * carry a `<host>.google` provider segment (cherryin, aihubmix, new-api), because
 * `resolveToolCapability`'s aggregator fallback lands on the same google factory. Their declarations
 * are exactly the ones narrowed to the `gemini` vendor, so read that instead of the host id — keying
 * the guard to the host let those gateways ship native tools alongside function tools.
 * Hosts that serve Gemini through their own search (OpenRouter's `plugins`) declare no gemini vendor
 * and stay out: nothing native is injected, so there is no conflict to avoid.
 */
function servesGeminiNativeWebTools(provider: Provider): boolean {
  if (isGeminiWebSearchProvider(provider)) return true
  return (provider.serverTools ?? []).some((tool) => tool.vendors?.includes('gemini'))
}

export function isSystemProvider(provider: Provider): boolean {
  return provider.presetProviderId != null
}

export function matchesPreset(provider: Pick<Provider, 'id' | 'presetProviderId'>, presetId: string): boolean {
  return provider.id === presetId || provider.presetProviderId === presetId
}

/**
 * Canonical preset providers are seeded built-ins whose runtime ID equals the
 * linked preset ID. Preset-derived user providers remain user-manageable.
 */
export function canManageProvider(provider: Provider): boolean {
  return provider.presetProviderId == null || provider.presetProviderId !== provider.id
}

/**
 * Providers whose API key is obtained via a hosted OAuth "get key" flow (the
 * `OauthButton`), keyed by runtime id. Single source of truth: `OauthButton`
 * supplies one handler per id (a missing handler is a compile error there), and
 * `isProviderSupportAuth` gates whether the button renders.
 */
export const API_KEY_OAUTH_PROVIDER_IDS = ['302ai', 'silicon', 'aihubmix', 'ppio', 'aionly'] as const

export function isProviderSupportAuth(provider: Pick<Provider, 'id'>): boolean {
  return (API_KEY_OAUTH_PROVIDER_IDS as readonly string[]).includes(provider.id)
}

/**
 * Login-based providers authenticate via a sign-in flow (CLI login / hosted
 * OAuth) and accept no user API key, so the generic API-key/host UI is
 * suppressed and their sign-in panel renders through the provider registry
 * instead. Derived from the provider's `authMethods` (registry capability):
 * login-based ⇔ it declares methods and none is `'api-key'`. Absent ⇒ default
 * `['api-key']` ⇒ not login-based. CherryIN declares `['api-key', 'oauth']`, so
 * it is *not* login-based — its key inputs stay alongside the OAuth panel.
 */
export function isLoginBasedProvider(provider: Pick<Provider, 'authMethods'>): boolean {
  const methods = provider.authMethods
  return methods !== undefined && methods.length > 0 && !methods.includes('api-key')
}

/**
 * External-CLI providers (e.g. Claude Code) reuse a CLI's own stored login and
 * hold no app-side credential, so they cannot serve a normal chat/generation
 * request: they are surfaced only to agent pickers (hidden from chat selectors,
 * rejected as a topic-naming model). Capability-derived from `authMethods`, not
 * keyed to a specific provider id, so a second such provider is covered for free.
 */
export function isExternalCliProvider(provider: Pick<Provider, 'authMethods'>): boolean {
  return provider.authMethods?.includes('external-cli') ?? false
}

export function isAnthropicSupportedProvider(provider: Provider): boolean {
  return getProviderHostTopology(provider).hasAnthropicEndpoint
}

/** Effective Fast support belongs to the provider-model pair, not either side alone. */
export function isSupportFastMode(
  provider: Pick<Provider, 'fastMode'>,
  model: Pick<Model, 'supportsFastMode'>
): provider is Pick<Provider, 'fastMode'> & { fastMode: NonNullable<Provider['fastMode']> } {
  return provider.fastMode !== undefined && model.supportsFastMode === true
}

/**
 * The dialect this host speaks on one endpoint. Declared per endpoint because
 * the same provider may expose chat-completions and Responses with different
 * compatibility behavior.
 */
export function resolveEndpointDialect(
  provider: Pick<Provider, 'endpointConfigs'>,
  endpointType: EndpointType | undefined
): Required<EndpointDialect> {
  const declared = endpointType ? provider.endpointConfigs?.[endpointType]?.dialect : undefined
  return {
    streamOptions: declared?.streamOptions ?? true,
    developerRole: declared?.developerRole ?? false,
    reasoningSummary: declared?.reasoningSummary ?? false
  }
}

function getServerTool(provider: Pick<Provider, 'serverTools'>, id: ServerTool) {
  return provider.serverTools?.find((tool) => tool.id === id)
}

/** Whether the host serves this tool for the model's vendor family (declaration `vendors` narrowing). */
function serverToolServesModelVendor(tool: ServerToolConfig, model: Model): boolean {
  if (!tool.vendors?.length) return true
  // VENDOR_PATTERNS are anchored and assume a namespace-stripped id: a gateway's
  // `google/gemini-3-pro-preview` matches nothing, silently withholding the tool from
  // every namespaced model whose vendor slug differs from its namespace.
  const vendor = matchVendor(getLowerBaseModelName(getRawModelId(model)))
  return vendor !== undefined && tool.vendors.includes(vendor)
}

/** Whether the host serves this tool over the effective endpoint protocol. */
function serverToolServesEndpoint(tool: ServerToolConfig, endpointType: EndpointType | undefined): boolean {
  if (!tool.endpointTypes?.length) return true
  return endpointType !== undefined && tool.endpointTypes.includes(endpointType)
}

function resolveServerToolEndpoint(
  model: Model,
  provider: Pick<Provider, 'defaultChatEndpoint'>,
  endpointType: EndpointType | undefined
): EndpointType | undefined {
  return endpointType ?? model.endpointTypes?.[0] ?? provider.defaultChatEndpoint
}

/** Model-side eligibility for a provider-native tool, compiled from the serving provider declaration. */
export function isServerToolModelEligible(
  model: Model,
  provider: Pick<Provider, 'id' | 'presetProviderId'>,
  tool: ServerTool
): boolean {
  if (isNonChatModel(model)) return false

  return isRegistryServerToolModelEligible(getRawModelId(model), provider.presetProviderId ?? provider.id, tool)
}

/** Effective built-in web-search availability for one provider-model pair. */
export function isBuiltinWebSearchAvailable(
  model: Model,
  provider: Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'serverTools'>,
  endpointType?: EndpointType
): boolean {
  const tool = getServerTool(provider, SERVER_TOOL.WEB_SEARCH)
  if (
    !tool ||
    !serverToolServesModelVendor(tool, model) ||
    !serverToolServesEndpoint(tool, resolveServerToolEndpoint(model, provider, endpointType))
  ) {
    return false
  }

  if (tool.modelScope === SERVER_TOOL_MODEL_SCOPE.ALL_CHAT_MODELS) {
    return !isNonChatModel(model)
  }

  return isServerToolModelEligible(model, provider, SERVER_TOOL.WEB_SEARCH)
}

export type WebToolRoute = 'client' | 'server' | 'none'

/** Why an enabled web capability resolved to 'none' — codes only, UI maps them to copy. */
export type WebToolUnavailableReason =
  | 'no-backend'
  | 'model-unsupported'
  | 'gemini-function-tool-conflict'
  | 'openai-minimal-reasoning'

export interface WebToolRoutes {
  webSearch: WebToolRoute
  webFetch: WebToolRoute
  reasons?: Partial<Record<'webSearch' | 'webFetch', WebToolUnavailableReason>>
}

/** Effective provider-native URL-fetch availability for one provider-model pair. */
export function isBuiltinWebFetchAvailable(
  model: Model,
  provider: Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint' | 'serverTools'>,
  endpointType?: EndpointType
): boolean {
  const tool = getServerTool(provider, SERVER_TOOL.URL_CONTEXT)
  if (
    !tool ||
    !serverToolServesModelVendor(tool, model) ||
    !serverToolServesEndpoint(tool, resolveServerToolEndpoint(model, provider, endpointType))
  ) {
    return false
  }

  if (tool.modelScope === SERVER_TOOL_MODEL_SCOPE.ALL_CHAT_MODELS) {
    return !isNonChatModel(model)
  }

  return isServerToolModelEligible(model, provider, SERVER_TOOL.URL_CONTEXT)
}

/**
 * Select one web-tool side for a request, then expose only the capabilities
 * available on that side.
 *
 * Provider/model conflicts (pre-3 Gemini native tools × function tools, OpenAI
 * GPT-5 minimal reasoning × native web_search) enter here as availability
 * inputs, so a conflicted server side falls back to the client tools instead
 * of being vetoed downstream. Each capability that lands on 'none' carries a
 * reason code for UI messaging.
 */
export function resolveWebToolRoutes(
  model: Model,
  provider: Provider | undefined,
  options: {
    webSearchEnabled: boolean
    clientSearchAvailable: boolean
    clientFetchAvailable: boolean
    modelToolsPreferred: boolean
    /** Non-web function tools expected on the request (MCP/KB/attachments/…); predictive in the renderer. */
    hasFunctionToolSignals?: boolean
    /** Effective reasoning effort selection for the request. */
    reasoningEffort?: string
    /** Effective endpoint protocol selected for this request. */
    endpointType?: EndpointType
  }
): WebToolRoutes {
  const supportsClientTools = isFunctionCallingModel(model)
  const clientSearchAvailable = options.webSearchEnabled && supportsClientTools && options.clientSearchAvailable
  const clientFetchAvailable = options.webSearchEnabled && supportsClientTools && options.clientFetchAvailable
  const serverSearchEligible =
    options.webSearchEnabled && provider ? isBuiltinWebSearchAvailable(model, provider, options.endpointType) : false
  const serverFetchEligible =
    options.webSearchEnabled && provider ? isBuiltinWebFetchAvailable(model, provider, options.endpointType) : false

  const googleToolConflict =
    options.hasFunctionToolSignals === true &&
    supportsClientTools &&
    provider !== undefined &&
    servesGeminiNativeWebTools(provider) &&
    isGeminiModel(model) &&
    !supportsServerToolFunctionMixing(getRawModelId(model))
  const openaiMinimalConflict =
    options.reasoningEffort !== undefined &&
    provider !== undefined &&
    (isOpenAIProvider(provider) || isOpenAIChatProvider(provider) || isAzureOpenAIProvider(provider)) &&
    isWebSearchEffortUnsupported(getRawModelId(model), options.reasoningEffort)

  const serverSearchAvailable = serverSearchEligible && !googleToolConflict && !openaiMinimalConflict
  const serverFetchAvailable = serverFetchEligible && !googleToolConflict
  const clientAvailable = clientSearchAvailable || clientFetchAvailable
  const serverAvailable = serverSearchAvailable || serverFetchAvailable

  const selectedSide: Exclude<WebToolRoute, 'none'> | undefined = options.modelToolsPreferred
    ? serverAvailable
      ? 'server'
      : clientAvailable
        ? 'client'
        : undefined
    : clientAvailable
      ? 'client'
      : serverAvailable
        ? 'server'
        : undefined

  const webSearch: WebToolRoute =
    selectedSide === 'client' && clientSearchAvailable
      ? 'client'
      : selectedSide === 'server' && serverSearchAvailable
        ? 'server'
        : 'none'
  const webFetch: WebToolRoute =
    selectedSide === 'client' && clientFetchAvailable
      ? 'client'
      : selectedSide === 'server' && serverFetchAvailable
        ? 'server'
        : 'none'

  const reasons: NonNullable<WebToolRoutes['reasons']> = {}
  if (webSearch === 'none') {
    reasons.webSearch =
      serverSearchEligible && googleToolConflict
        ? 'gemini-function-tool-conflict'
        : serverSearchEligible && openaiMinimalConflict
          ? 'openai-minimal-reasoning'
          : options.clientSearchAvailable && !supportsClientTools
            ? 'model-unsupported'
            : 'no-backend'
  }
  if (webFetch === 'none') {
    reasons.webFetch =
      serverFetchEligible && googleToolConflict
        ? 'gemini-function-tool-conflict'
        : options.clientFetchAvailable && !supportsClientTools
          ? 'model-unsupported'
          : 'no-backend'
  }

  return { webSearch, webFetch, ...(Object.keys(reasons).length > 0 ? { reasons } : {}) }
}

/**
 * Final request-time amendment to the routes, once the resolved ToolSet is
 * known: pre-3 Gemini rejects requests mixing its native tools with function
 * tools, so surviving server routes are withdrawn. Normally the conflict is
 * already predicted by `resolveWebToolRoutes` (which prefers falling back to
 * the client side); this is the exact safety net for under-predicted signals.
 * The amended routes are the single source of truth on the request scope.
 */
export function finalizeWebToolRoutes(
  routes: WebToolRoutes,
  model: Model,
  provider: Provider,
  hasFunctionTools: boolean
): WebToolRoutes {
  if (!hasFunctionTools || !isGeminiModel(model) || supportsServerToolFunctionMixing(getRawModelId(model))) {
    return routes
  }

  let next = routes
  if (next.webFetch === 'server') {
    next = { ...next, webFetch: 'none', reasons: { ...next.reasons, webFetch: 'gemini-function-tool-conflict' } }
  }
  // Search only conflicts when the injected tool is Google's own — gemini/vertex directly, plus the
  // gateways that resolve the same google factory. OpenRouter serves gemini models with its own
  // search, which tolerates function tools.
  if (next.webSearch === 'server' && servesGeminiNativeWebTools(provider)) {
    next = { ...next, webSearch: 'none', reasons: { ...next.reasons, webSearch: 'gemini-function-tool-conflict' } }
  }
  return next
}

const NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS = ['ollama', 'lmstudio', 'nvidia', 'gpustack'] as const

export function isSupportEnableThinkingProvider(provider: Provider): boolean {
  return !NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS.some((id) => id === provider.id)
}

export function hasApiKeys(provider: Provider): boolean {
  return provider.apiKeys.length > 0 && provider.apiKeys.some((k) => k.isEnabled)
}

export function getClaudeSupportedProviders<T extends Provider>(providers: T[]): T[] {
  return providers.filter(
    (p) =>
      isAnthropicProvider(p) ||
      isNewApiProvider(p) ||
      p.id === 'aihubmix' ||
      p.id === 'openrouter' ||
      isAzureOpenAIProvider(p)
  )
}

export function isSupportAnthropicPromptCacheProvider(provider: Provider): boolean {
  return (
    isAnthropicProvider(provider) ||
    isNewApiProvider(provider) ||
    provider.id === 'aihubmix' ||
    provider.id === 'openrouter' ||
    isAzureOpenAIProvider(provider)
  )
}

/**
 * Sanitize a provider display name for use in config file keys / launch args.
 * Shared by the renderer (writes CLI config files) and main (assembles the
 * matching launch command) — they must agree on the exact same output.
 */
export function sanitizeProviderName(name: string, fallback: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_\s.-]/g, '').replace(/\s+/g, '-')
  return sanitized || fallback
}
