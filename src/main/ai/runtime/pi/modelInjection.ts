/**
 * Resolve a Cherry `UniqueModelId` into the pi provider/model configuration a
 * pi `AgentSession` needs. Cherry owns the model + API key; this module maps
 * Cherry's provider/model/endpoint data onto pi's `registerProvider` shape.
 *
 * Key ownership (plan D1): the raw Cherry API key is returned SEPARATELY and
 * never placed in the `registerProvider` config — the config carries only a
 * non-secret placeholder so keys that start with `$`/`!` never hit pi's config
 * interpolation semantics. The driver injects the real key at runtime via
 * `AuthStorage.setRuntimeApiKey(providerName, apiKey)` (Phase 2).
 */

import { application } from '@application'
import type { AiUsageCredentialReceipt } from '@data/services/AiUsageRecordService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent'
import { createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import { mapEndpointToPiApi, type PiApi } from '@shared/ai/piModelCompatibility'
import { isCodexProviderId } from '@shared/data/presets/codex'
import { hasRuntimeTransportAdapter } from '@shared/data/presets/runtimeTransport'
import {
  ENDPOINT_TYPE,
  type EndpointType,
  MODALITY,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'
import { isLoginBasedProvider, resolveEndpointDialect } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { getProviderTransportAdapter, type ProviderTransportAdapter } from '../../provider/runtimeTransport'
import { requiresAgentGateway, resolveApiGatewayRuntime } from '../agentApiGateway'
import { resolveAgentContextWindow } from '../agentContextWindow'
import { toAgentProviderHeaders } from '../agentProviderHeaders'
import type { AgentSessionUsageCapture } from '../types'
import { loadPiAnthropicMessagesApi, loadPiApiStreamSimple } from './piSdk'
import { withCherryInThinkingReplay } from './piThinkingReplay'
import { loadPiAiStreamFns, withTransportStream } from './piTransportStream'

/**
 * Non-secret placeholder written into the `registerProvider` config. pi
 * validates that a custom-model provider declares `apiKey` (or `oauth`), so we
 * satisfy it with this literal and supply the real key out-of-band.
 */
export const PI_PLACEHOLDER_API_KEY = 'cherry-managed-runtime-key'

// Pi uses maxTokens as a request output cap. Keep the existing conservative
// default when Cherry has no more specific output limit.
const DEFAULT_MAX_TOKENS = 8_192

/** Thrown when the selected model's provider has no pi `api` mapping (plan D2). */
export class PiUnsupportedProviderError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Provider "${providerId}" is not supported by pi agents: no compatible pi API family`)
    this.name = 'PiUnsupportedProviderError'
    this.providerId = providerId
  }
}

/** Thrown when Cherry has no usable API key for the selected pi provider. */
export class PiMissingApiKeyError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Provider "${providerId}" has no API key configured for pi agents`)
    this.name = 'PiMissingApiKeyError'
    this.providerId = providerId
  }
}

interface PiProviderInjectionBase {
  /** pi provider name to register + target with `setRuntimeApiKey`. Cherry's provider id. */
  providerName: string
  /** Resolved Pi wire family; duplicated from providerConfig because that SDK field is optional in its public type. */
  api: PiApi
  /** Config for `pi.registerProvider(providerName, config)`. `apiKey` is the placeholder. */
  providerConfig: ProviderConfig
  /** The real Cherry API key — inject via `AuthStorage.setRuntimeApiKey`, never into the config. */
  apiKey: string
  /** The pi model id to select for the session (Cherry's `apiModelId`). */
  modelId: string
  /**
   * Present for app-managed-OAuth providers. When set, the connection wires a
   * `streamSimple` onto the pi provider config that fetches per-call OAuth creds
   * from this adapter; `apiKey` is then only the placeholder (no real app-side key).
   */
  transportAdapter?: ProviderTransportAdapter
  /** Provider-specific environment consumed by pi-ai's request implementation. */
  requestEnvironment?: Record<string, string>
}

/** Native/OAuth route whose invocations are accounted for by the Agent SDK. */
export interface PiDirectProviderInjection extends PiProviderInjectionBase {
  usageCapture: Extract<AgentSessionUsageCapture, { owner: 'agent-sdk' }>
}

/** Local gateway route whose provider calls are accounted for by gateway middleware. */
export interface PiGatewayProviderInjection extends PiProviderInjectionBase {
  usageCapture: Extract<AgentSessionUsageCapture, { owner: 'provider-calls' }>
}

export type PiProviderInjection = PiDirectProviderInjection | PiGatewayProviderInjection

/** Materialize provider-specific stream compatibility before the connection consumes it. */
export async function materializePiProviderStream(injection: PiProviderInjection): Promise<{
  providerConfig: ProviderConfig
  streamSimple: NonNullable<ProviderConfig['streamSimple']>
}> {
  const providerConfig = injection.transportAdapter
    ? withTransportStream(injection.providerConfig, injection.transportAdapter, await loadPiAiStreamFns())
    : injection.providerName === 'cherryin' && injection.api === 'anthropic-messages'
      ? withCherryInThinkingReplay(injection.providerConfig, (await loadPiAnthropicMessagesApi()).streamSimple)
      : injection.providerConfig
  return {
    providerConfig,
    streamSimple: providerConfig.streamSimple ?? (await loadPiApiStreamSimple(injection.api))
  }
}

function resolvePiEndpoint(provider: Provider, model: Model) {
  const preferredEndpoint =
    model.endpointTypes?.includes(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) &&
    model.endpointTypes.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      : undefined
  return resolveEffectiveEndpoint(provider, model, preferredEndpoint)
}

/**
 * Pure mapping: build the pi provider injection from an already-resolved Cherry
 * `Provider`, `Model`, and API key. Kept free of service/IO so it is unit
 * testable in isolation.
 *
 * @throws PiUnsupportedProviderError when the provider's endpoint has no pi mapping.
 */
export function buildPiProviderInjection(
  provider: Provider,
  model: Model,
  apiKey: string,
  credentialReceipt?: AiUsageCredentialReceipt
): PiDirectProviderInjection {
  // Unsupported-provider beats missing-key: a login-based provider (grok-cli,
  // claude-code) has no key by design, and "missing API key" would misdiagnose it.
  const resolvedEndpoint = resolvePiEndpoint(provider, model)
  const adapterFamily = resolvedEndpoint.endpointType
    ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
    : undefined
  const api =
    isLoginBasedProvider(provider) && !hasRuntimeTransportAdapter(provider.id)
      ? undefined
      : mapEndpointToPiApi(resolvedEndpoint.endpointType, adapterFamily)
  if (!api) {
    throw new PiUnsupportedProviderError(provider.id)
  }
  // Transport-adapter (app-managed-OAuth) providers authenticate per stream call
  // via the adapter; the connect-time `apiKey` is only the placeholder, so the
  // empty-key guard does not apply to them.
  const transportAdapter = getProviderTransportAdapter(provider.id)
  if (!transportAdapter && !apiKey.trim()) throw new PiMissingApiKeyError(provider.id)

  const baseUrl = isCodexProviderId(provider.id)
    ? formatApiHost(resolvedEndpoint.baseUrl, false)
    : formatPiBaseUrl(resolvedEndpoint.baseUrl, api)
  const modelId = getRawModelId(model)
  const modelConfig = buildPiModelConfig(provider, model, modelId, api, resolvedEndpoint.endpointType)

  const providerConfig: ProviderConfig = {
    name: provider.name,
    baseUrl,
    apiKey: PI_PLACEHOLDER_API_KEY,
    api,
    headers: toPiHeaders(provider.settings?.extraHeaders),
    models: [modelConfig]
  }

  return {
    providerName: provider.id,
    api,
    providerConfig,
    apiKey,
    modelId,
    usageCapture: {
      owner: 'agent-sdk',
      credentialReceipt:
        credentialReceipt ?? (transportAdapter ? { attribution: 'auth', method: 'oauth' } : { attribution: 'unknown' }),
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
    },
    ...(transportAdapter ? { transportAdapter } : {}),
    ...(api === 'azure-openai-responses' && provider.settings?.apiVersion?.trim()
      ? { requestEnvironment: { AZURE_OPENAI_API_VERSION: provider.settings.apiVersion.trim() } }
      : {})
  }
}

/**
 * Cherry header values are literals, but pi resolves each one as a `$ENV` / `!command`
 * template — the same interpolation the `apiKey` placeholder dodges.
 */
function toPiHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  const coerced = toAgentProviderHeaders(headers)
  if (!coerced) return undefined
  return Object.fromEntries(
    Object.entries(coerced).map(([name, value]) => [name, value.replaceAll('$', '$$$$').replace(/^!/, '$!')])
  )
}

/** Whether this provider declares that Pi must use Cherry's local Gateway route. */
export function usesPiGateway(provider: Provider): boolean {
  return requiresAgentGateway(provider.id)
}

/** Build a Pi route targeting Cherry's local Gateway while preserving the model's wire protocol. */
export function buildPiGatewayInjection(
  provider: Provider,
  model: Model,
  gateway: { baseUrl: string; apiKey: string; usageHeaders: Record<string, string> }
): PiGatewayProviderInjection {
  const resolvedEndpoint = resolvePiEndpoint(provider, model)
  const adapterFamily = resolvedEndpoint.endpointType
    ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
    : undefined
  const api = mapEndpointToPiApi(resolvedEndpoint.endpointType, adapterFamily)
  if (!api) throw new PiUnsupportedProviderError(provider.id)

  const modelId = formatGatewayModelId(provider.id, getRawModelId(model))
  const modelConfig = buildPiModelConfig(provider, model, modelId, api, resolvedEndpoint.endpointType)
  const headers = Object.keys(gateway.usageHeaders).length ? gateway.usageHeaders : undefined

  return {
    providerName: provider.id,
    api,
    providerConfig: {
      name: provider.name,
      baseUrl: formatPiBaseUrl(gateway.baseUrl, api),
      apiKey: PI_PLACEHOLDER_API_KEY,
      api,
      ...(headers ? { headers } : {}),
      models: [modelConfig]
    },
    apiKey: gateway.apiKey,
    modelId,
    usageCapture: { owner: 'provider-calls' }
  }
}

function formatPiBaseUrl(baseUrl: string, api: PiApi): string {
  switch (api) {
    case 'openai-completions':
    case 'openai-responses':
      return formatApiHost(baseUrl)
    case 'google-generative-ai':
      return formatApiHost(baseUrl, true, 'v1beta')
    case 'anthropic-messages':
      // Anthropic's SDK appends `/v1/messages` itself; unlike the AI SDK adapter,
      // pi needs the gateway root rather than a versioned API prefix.
      return withoutTrailingApiVersion(formatApiHost(baseUrl, false))
    case 'azure-openai-responses':
      return formatApiHost(baseUrl, false)
  }
}

/**
 * Resolve a Cherry `UniqueModelId` into a pi provider injection, fetching the
 * provider, model, and rotated API key from Cherry's data services.
 *
 * @throws PiUnsupportedProviderError when the provider has no pi mapping.
 */
export async function resolvePiProviderInjection(uniqueModelId: UniqueModelId): Promise<PiDirectProviderInjection> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const [provider, model] = await Promise.all([
    providerService.getByProviderId(providerId),
    modelService.getByKey(providerId, modelId)
  ])

  return resolvePiProviderInjectionFromSnapshot(provider, model)
}

/** Select one credential for already-captured provider/model facts without re-reading either row. */
export function resolvePiProviderInjectionFromSnapshot(
  provider: Provider,
  model: Model,
  enabledApiKeys?: readonly ApiKeyEntry[]
): PiDirectProviderInjection {
  // Transport-adapter providers hold no app-side key: the real OAuth token is
  // fetched per stream call by the adapter. Skip the round-robin key rotation.
  if (getProviderTransportAdapter(provider.id)) {
    return buildPiProviderInjection(provider, model, PI_PLACEHOLDER_API_KEY)
  }

  const resolvedApiKey = providerService.resolveApiKey(provider.id)
  if (!resolvedApiKey.value.trim()) throw new PiMissingApiKeyError(provider.id)
  if (enabledApiKeys && !enabledApiKeys.some((entry) => entry.key === resolvedApiKey.value)) {
    throw new Error(`Pi provider credentials changed during materialization: ${provider.id}`)
  }
  return buildPiProviderInjection(provider, model, resolvedApiKey.value, resolvedApiKey.apiKeySelection)
}

/** Resolve a session-bound Pi route, including provider-declared local Gateway transport. */
export async function resolvePiProviderInjectionForSession(
  sessionId: string,
  provider: Provider,
  model: Model,
  enabledApiKeys?: readonly ApiKeyEntry[]
): Promise<PiProviderInjection> {
  if (!usesPiGateway(provider)) {
    return resolvePiProviderInjectionFromSnapshot(provider, model, enabledApiKeys)
  }

  const gateway = await resolveApiGatewayRuntime(sessionId)
  return buildPiGatewayInjection(provider, model, gateway)
}

/**
 * Validate pi compatibility without consuming ProviderService's round-robin API
 * key rotation. Dispatch validation runs before every turn; selecting the key is
 * a connect-time concern only.
 */
export async function assertPiProviderUsable(uniqueModelId: UniqueModelId): Promise<void> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const [provider, model] = await Promise.all([
    providerService.getByProviderId(providerId),
    modelService.getByKey(providerId, modelId)
  ])

  // Provider-declared Gateway routes authenticate at materialization time, not with a provider key.
  if (usesPiGateway(provider)) {
    const resolvedEndpoint = resolvePiEndpoint(provider, model)
    const adapterFamily = resolvedEndpoint.endpointType
      ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
      : undefined
    if (!mapEndpointToPiApi(resolvedEndpoint.endpointType, adapterFamily)) {
      throw new PiUnsupportedProviderError(providerId)
    }
    return
  }

  // Unsupported beats missing-credential (parity with buildPiProviderInjection):
  // a login-based provider with no adapter has no key by design, and reporting
  // "missing API key" for it would misdiagnose an unsupported provider.
  const resolvedEndpoint = resolvePiEndpoint(provider, model)
  const adapterFamily = resolvedEndpoint.endpointType
    ? provider.endpointConfigs?.[resolvedEndpoint.endpointType]?.adapterFamily
    : undefined
  if (
    (isLoginBasedProvider(provider) && !hasRuntimeTransportAdapter(provider.id)) ||
    !mapEndpointToPiApi(resolvedEndpoint.endpointType, adapterFamily)
  ) {
    throw new PiUnsupportedProviderError(providerId)
  }
  // Transport-adapter providers validate the OAuth session (cheap `hasToken`),
  // not app-side keys; a signed-out provider is surfaced as a missing credential.
  if (getProviderTransportAdapter(providerId)) {
    const signedIn = await application.get('OAuthRuntimeService').hasToken(providerId)
    if (!signedIn) throw new PiMissingApiKeyError(providerId)
    return
  }

  const apiKeys = providerService.getApiKeys(providerId, { enabled: true })
  if (!apiKeys.some((entry) => entry.key.trim())) throw new PiMissingApiKeyError(providerId)
}

function buildPiModelConfig(
  provider: Provider,
  model: Model,
  id: string,
  api: PiApi,
  endpointType: EndpointType | undefined
): ProviderModelConfig {
  const input: ('text' | 'image')[] = ['text']
  const supportsImage =
    model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) ||
    (model.inputModalities?.includes(MODALITY.IMAGE) ?? false)
  if (supportsImage) {
    input.push('image')
  }

  return {
    id,
    name: model.name,
    api,
    reasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined,
    input,
    // pi tracks per-token cost for its own UI; Cherry owns cost accounting, so
    // leave zeros — pi's tracking is unused here.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: resolveAgentContextWindow(model),
    maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    // Cherry's provider capability is the source of truth; pi otherwise infers
    // developer-role support from the endpoint URL.
    ...(api === 'openai-completions' || api === 'openai-responses'
      ? { compat: { supportsDeveloperRole: resolveEndpointDialect(provider, endpointType).developerRole } }
      : {}),
    // CherryIN requires replaying its thinking block even when the compatible endpoint omits a signature delta.
    ...(provider.id === 'cherryin' && api === 'anthropic-messages' ? { compat: { allowEmptySignature: true } } : {})
    // thinkingLevelMap intentionally omitted: Cherry does not wire pi
    // thinking-level control in v1 (see capability matrix).
  }
}
