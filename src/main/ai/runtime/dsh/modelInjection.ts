/**
 * Resolve a Cherry `UniqueModelId` into the provider route a dsh composition's
 * `dsh-llm-pi-ai` entry needs. Cherry owns the model + API key; this module maps
 * Cherry's provider/model/endpoint data onto the hand-declared YAML route shape.
 *
 * Key ownership: the raw Cherry API key is returned SEPARATELY and never placed
 * in the generated YAML — the composition carries only `apiKeyEnv:
 * CHERRY_DSH_API_KEY` and the driver injects the real key through the child
 * process environment.
 */

import { application } from '@application'
import type { ReasoningEffort } from '@cherrystudio/provider-registry'
import type { AiUsageCredentialReceipt } from '@data/services/AiUsageRecordService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import { DSH_ENDPOINT_TYPES, type DshApi, mapEndpointToDshApi } from '@shared/ai/dshModelCompatibility'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId, isGatewayRoutableModel, isReasoningModel, isVisionModel } from '@shared/utils/model'
import { isLoginBasedProvider } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { ApiGatewayNotRunningError, resolveApiGatewayRuntime } from '../agentApiGateway'
import { resolveAgentContextWindow } from '../agentContextWindow'
import { toAgentProviderHeaders } from '../agentProviderHeaders'
import type { AgentSessionUsageCapture } from '../types'

// dsh-llm-pi-ai uses maxTokens as a per-request output cap. Keep pi's
// conservative default when Cherry has no more specific output limit.
const DEFAULT_MAX_TOKENS = 8_192

/** Thrown when the selected model's provider has no dsh `api` mapping. */
export class DshUnsupportedProviderError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Provider "${providerId}" is not supported by dsh agents: no compatible dsh API protocol`)
    this.name = 'DshUnsupportedProviderError'
    this.providerId = providerId
  }
}

/** Thrown when Cherry has no usable API key for the selected dsh provider. */
export class DshMissingApiKeyError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Provider "${providerId}" has no API key configured for dsh agents`)
    this.name = 'DshMissingApiKeyError'
    this.providerId = providerId
  }
}

export type DshInputModality = 'text' | 'image'
export type DshReasoningEffort = Exclude<ReasoningEffort, 'none' | 'auto'> | 'off'
export type DshReasoningEfforts = Partial<Record<DshReasoningEffort, string | null>>

const DSH_ADJUSTABLE_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function isDshAdjustableReasoningEffort(
  value: ReasoningEffort | undefined
): value is Exclude<ReasoningEffort, 'none' | 'auto'> {
  return (
    value !== undefined && DSH_ADJUSTABLE_REASONING_EFFORTS.includes(value as Exclude<ReasoningEffort, 'none' | 'auto'>)
  )
}

function resolveDshAutoReasoningEffort(model: Model): Exclude<DshReasoningEffort, 'off'> {
  const defaultEffort = model.reasoning?.defaultEffort
  return isDshAdjustableReasoningEffort(defaultEffort) ? defaultEffort : 'high'
}

/** Project Cherry's reasoning selection onto the levels supported by dsh rc.6. */
export function resolveDshReasoningEffort(
  model: Model,
  selection: ReasoningEffortOption = 'default'
): DshReasoningEffort | undefined {
  if (selection === 'default') return undefined

  const selectable = model.reasoning?.selectableEfforts ?? []
  if (!selectable.includes(selection)) return undefined
  if (selection === 'none') return 'off'
  if (selection === 'auto') return resolveDshAutoReasoningEffort(model)
  return selection
}

function buildDshReasoningEfforts(model: Model, selected?: DshReasoningEffort): false | DshReasoningEfforts {
  if (!isReasoningModel(model)) return false

  const efforts: DshReasoningEfforts = {}
  for (const effort of model.reasoning?.selectableEfforts ?? []) {
    if (isDshAdjustableReasoningEffort(effort)) efforts[effort] = effort
    else if (effort === 'auto') {
      const projected = resolveDshAutoReasoningEffort(model)
      efforts[projected] = projected
    }
  }

  // Fixed/toggle-only reasoning models still need metadata so pi-ai retains
  // reasoning blocks. The profile stays unset for Cherry's Default selection.
  if (!Object.keys(efforts).length) {
    const fallback = resolveDshAutoReasoningEffort(model)
    efforts[fallback] = fallback
  }
  // In pi-ai, advertising Off changes the no-selection default for some
  // dialects. Declare it only on a connection that explicitly selected None.
  if (selected === 'off') efforts.off = null
  return efforts
}

/** Hand-declared `dsh-llm-pi-ai` route model entry (context window REQUIRED). */
export interface DshModelConfig {
  id: string
  name?: string
  contextWindow: number
  maxTokens: number
  input: DshInputModality[]
  reasoningEfforts: false | DshReasoningEfforts
  /** OpenAI-compatible protocol overrides owned by Cherry's provider settings. */
  compat?: { supportsDeveloperRole: boolean }
}

export interface DshProviderInjection {
  /** dsh provider route key (the `providers` dict key); Google uses pi-ai's catalog key. */
  providerName: string
  /** Resolved transport family; Google is selected by catalog key rather than an explicit `api` field. */
  api: DshApi
  /** Endpoint for the route's `baseURL` field. */
  baseUrl: string
  /** Provider request headers, when Cherry configures extras. */
  headers?: Record<string, string>
  /** The real Cherry API key — inject via child env `CHERRY_DSH_API_KEY`, never into the YAML. */
  apiKey: string
  /** The dsh model id to select for the session (Cherry's `apiModelId`). */
  modelId: string
  /** Connection-frozen reasoning level; absent preserves the provider default. */
  reasoning?: DshReasoningEffort
  /** The route's single hand-declared model entry. */
  modelConfig: DshModelConfig
  /** Frozen attribution for the connection's credential; gateway routes flip to
   *  `provider-calls` because the gateway middleware records usage itself. */
  usageCapture: AgentSessionUsageCapture
}

function resolveDshEndpoint(provider: Provider, model: Model) {
  return resolveEffectiveEndpoint(provider, model, undefined, DSH_ENDPOINT_TYPES)
}

/**
 * Effective-endpoint variant of shared `resolveDshApi`: services resolve the
 * concrete route, so this is the branch condition for native vs gateway.
 */
export function resolveDshInjectionApi(provider: Provider, model: Model): DshApi | undefined {
  if (isLoginBasedProvider(provider)) return undefined
  const resolvedEndpoint = resolveDshEndpoint(provider, model)
  const adapterFamily = resolvedEndpoint.endpointType
    ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
    : undefined
  return mapEndpointToDshApi(resolvedEndpoint.endpointType, adapterFamily)
}

/**
 * Pure mapping: build the dsh provider injection from an already-resolved
 * Cherry `Provider`, `Model`, and API key. Kept free of service/IO so it is
 * unit testable in isolation.
 *
 * @throws DshUnsupportedProviderError when the provider's endpoint has no dsh mapping.
 */
export function buildDshProviderInjection(
  provider: Provider,
  model: Model,
  apiKey: string,
  credentialReceipt?: AiUsageCredentialReceipt,
  reasoningEffort: ReasoningEffortOption = 'default'
): DshProviderInjection {
  // Unsupported-provider beats missing-key: a login-based provider has no key
  // by design, and "missing API key" would misdiagnose it. dsh runs as a
  // subprocess with no per-request transport injection, so every login-based
  // provider is undrivable (parity with shared `resolveDshApi`).
  const resolvedEndpoint = resolveDshEndpoint(provider, model)
  const adapterFamily = resolvedEndpoint.endpointType
    ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
    : undefined
  const api = isLoginBasedProvider(provider)
    ? undefined
    : mapEndpointToDshApi(resolvedEndpoint.endpointType, adapterFamily)
  if (!api) {
    throw new DshUnsupportedProviderError(provider.id)
  }
  if (!apiKey.trim()) throw new DshMissingApiKeyError(provider.id)

  const baseUrl = formatDshBaseUrl(resolvedEndpoint.baseUrl, api)
  const modelId = getRawModelId(model)
  const headers = toAgentProviderHeaders(provider.settings?.extraHeaders)
  const reasoning = resolveDshReasoningEffort(model, reasoningEffort)

  return {
    // rc.6 reaches Google Generate Content only through pi-ai's built-in catalog route.
    providerName: api === 'google-generative-ai' ? 'google' : provider.id,
    api,
    baseUrl,
    ...(headers ? { headers } : {}),
    apiKey,
    modelId,
    ...(reasoning ? { reasoning } : {}),
    modelConfig: {
      id: modelId,
      ...(model.name ? { name: model.name } : {}),
      contextWindow: resolveAgentContextWindow(model),
      maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      input: isVisionModel(model) ? ['text', 'image'] : ['text'],
      reasoningEfforts: buildDshReasoningEfforts(model, reasoning),
      ...(api === 'openai-completions' || api === 'openai-responses'
        ? {
            compat: {
              supportsDeveloperRole:
                (resolvedEndpoint.endpointType
                  ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.dialect?.developerRole
                  : undefined) ?? false
            }
          }
        : {})
    },
    usageCapture: {
      owner: 'agent-sdk',
      credentialReceipt: credentialReceipt ?? { attribution: 'unknown' },
      providerId: provider.id,
      providerName: provider.name ?? null,
      source: null,
      frozenModels: [
        {
          modelId: model.id,
          apiModelId: modelId,
          modelName: model.name ?? model.id,
          aliases: [...new Set([model.id, modelId])],
          pricingSnapshot: createAiUsagePricingSnapshot(model.pricing)
        }
      ]
    }
  }
}

/**
 * Gateway-route counterpart of {@link buildDshProviderInjection}: the local API
 * Gateway fronts a model with no native dsh wire family as OpenAI-compatible.
 * The gateway key is a secret like any native key — it reaches the child only
 * through `CHERRY_DSH_API_KEY`, never the YAML. The session usage headers ride
 * the route's `headers` so the gateway can attach provider usage to the owning
 * agent message and apply the stable per-session prompt cache key.
 *
 * @throws DshUnsupportedProviderError when the model is not gateway-routable either.
 */
export function buildDshGatewayInjection(
  provider: Provider,
  model: Model,
  gateway: { baseUrl: string; apiKey: string; usageHeaders: Record<string, string> },
  reasoningEffort: ReasoningEffortOption = 'default'
): DshProviderInjection {
  if (!isGatewayRoutableModel(model)) throw new DshUnsupportedProviderError(provider.id)
  const modelId = formatGatewayModelId(provider.id, getRawModelId(model))
  const reasoning = resolveDshReasoningEffort(model, reasoningEffort)
  return {
    providerName: provider.id,
    api: 'openai-completions',
    baseUrl: formatDshBaseUrl(gateway.baseUrl, 'openai-completions'),
    ...(Object.keys(gateway.usageHeaders).length ? { headers: gateway.usageHeaders } : {}),
    apiKey: gateway.apiKey,
    modelId,
    ...(reasoning ? { reasoning } : {}),
    modelConfig: {
      id: modelId,
      ...(model.name ? { name: model.name } : {}),
      contextWindow: resolveAgentContextWindow(model),
      maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      input: isVisionModel(model) ? ['text', 'image'] : ['text'],
      reasoningEfforts: buildDshReasoningEfforts(model, reasoning),
      compat: { supportsDeveloperRole: true }
    },
    // The gateway middleware records provider usage; agent-sdk capture would double-count.
    usageCapture: { owner: 'provider-calls' }
  }
}

/** dsh's LLM layer is pi-ai, so its transport-specific base URL rules apply. */
function formatDshBaseUrl(baseUrl: string, api: DshApi): string {
  switch (api) {
    case 'openai-completions':
    case 'openai-responses':
      return formatApiHost(baseUrl)
    case 'google-generative-ai':
      return formatApiHost(baseUrl, true, 'v1beta')
    case 'anthropic-messages':
      // Anthropic's SDK appends `/v1/messages` itself; pi-ai needs the gateway
      // root rather than a versioned API prefix.
      return withoutTrailingApiVersion(formatApiHost(baseUrl, false))
  }
}

/** Select one credential for already-captured provider/model facts without re-reading either row. */
export async function resolveDshProviderInjectionFromSnapshot(
  sessionId: string,
  provider: Provider,
  model: Model,
  enabledApiKeys?: readonly ApiKeyEntry[],
  reasoningEffort: ReasoningEffortOption = 'default'
): Promise<DshProviderInjection> {
  if (resolveDshInjectionApi(provider, model) === undefined) {
    // Claude's gateway sequence: consent (ApiGatewayNotRunningError), converge, materialize key.
    const gateway = await resolveApiGatewayRuntime(sessionId)
    return buildDshGatewayInjection(provider, model, gateway, reasoningEffort)
  }
  const resolvedApiKey = providerService.resolveApiKey(provider.id)
  if (!resolvedApiKey.value.trim()) throw new DshMissingApiKeyError(provider.id)
  if (enabledApiKeys && !enabledApiKeys.some((entry) => entry.key === resolvedApiKey.value)) {
    throw new Error(`dsh provider credentials changed during materialization: ${provider.id}`)
  }
  return buildDshProviderInjection(
    provider,
    model,
    resolvedApiKey.value,
    resolvedApiKey.apiKeySelection,
    reasoningEffort
  )
}

/**
 * Validate dsh compatibility without consuming ProviderService's round-robin
 * API key rotation. Dispatch validation runs before every turn; selecting the
 * key is a connect-time concern only.
 */
export async function assertDshProviderUsable(uniqueModelId: UniqueModelId): Promise<void> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const [provider, model] = await Promise.all([
    providerService.getByProviderId(providerId),
    modelService.getByKey(providerId, modelId)
  ])

  // Unsupported beats missing-credential (parity with buildDshProviderInjection).
  if (resolveDshInjectionApi(provider, model) === undefined) {
    if (!isGatewayRoutableModel(model)) throw new DshUnsupportedProviderError(providerId)
    // Consent only (persisted intent) — no ensureRunning/ensureValidApiKey side effects here.
    if (!application.get('ApiGatewayService').getCurrentConfig().enabled) throw new ApiGatewayNotRunningError()
    return
  }
  const apiKeys = providerService.getApiKeys(providerId, { enabled: true })
  if (!apiKeys.some((entry) => entry.key.trim())) throw new DshMissingApiKeyError(providerId)
}
