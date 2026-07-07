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
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent'
import { type PiApi, resolvePiApi } from '@shared/ai/piModelCompatibility'
import {
  MODALITY,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { getProviderTransportAdapter, type ProviderTransportAdapter } from '../../provider/runtimeTransport'

/**
 * Non-secret placeholder written into the `registerProvider` config. pi
 * validates that a custom-model provider declares `apiKey` (or `oauth`), so we
 * satisfy it with this literal and supply the real key out-of-band.
 */
export const PI_PLACEHOLDER_API_KEY = 'cherry-managed-runtime-key'

// Fallbacks for models that omit these fields. pi requires numbers; Cherry
// owns real accounting/limits elsewhere, so conservative defaults are fine.
// simplification ceiling: thread real per-model limits if pi surfaces them.
const DEFAULT_CONTEXT_WINDOW = 128_000
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

export interface PiProviderInjection {
  /** pi provider name to register + target with `setRuntimeApiKey`. Cherry's provider id. */
  providerName: string
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
}

/**
 * Pure mapping: build the pi provider injection from an already-resolved Cherry
 * `Provider`, `Model`, and API key. Kept free of service/IO so it is unit
 * testable in isolation.
 *
 * @throws PiUnsupportedProviderError when the provider's endpoint has no pi mapping.
 */
export function buildPiProviderInjection(provider: Provider, model: Model, apiKey: string): PiProviderInjection {
  // Unsupported-provider beats missing-key: a login-based provider (grok-cli,
  // claude-code) has no key by design, and "missing API key" would misdiagnose it.
  const api = resolvePiApi(provider, model)
  if (!api) {
    throw new PiUnsupportedProviderError(provider.id)
  }
  // Transport-adapter (app-managed-OAuth) providers authenticate per stream call
  // via the adapter; the connect-time `apiKey` is only the placeholder, so the
  // empty-key guard does not apply to them.
  const transportAdapter = getProviderTransportAdapter(provider.id)
  if (!transportAdapter && !apiKey.trim()) throw new PiMissingApiKeyError(provider.id)

  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  const modelId = model.apiModelId ?? model.id
  const modelConfig = buildPiModelConfig(model, modelId, api)

  const providerConfig: ProviderConfig = {
    name: provider.name,
    baseUrl,
    apiKey: PI_PLACEHOLDER_API_KEY,
    api,
    models: [modelConfig]
  }

  return {
    providerName: provider.id,
    providerConfig,
    apiKey,
    modelId,
    ...(transportAdapter ? { transportAdapter } : {})
  }
}

/**
 * Resolve a Cherry `UniqueModelId` into a pi provider injection, fetching the
 * provider, model, and rotated API key from Cherry's data services.
 *
 * @throws PiUnsupportedProviderError when the provider has no pi mapping.
 */
export async function resolvePiProviderInjection(uniqueModelId: UniqueModelId): Promise<PiProviderInjection> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const [provider, model] = await Promise.all([
    providerService.getByProviderId(providerId),
    modelService.getByKey(providerId, modelId)
  ])

  // Transport-adapter providers hold no app-side key: the real OAuth token is
  // fetched per stream call by the adapter. Skip the round-robin key rotation
  // entirely and register with the non-secret placeholder.
  if (getProviderTransportAdapter(providerId)) {
    return buildPiProviderInjection(provider, model, PI_PLACEHOLDER_API_KEY)
  }

  const apiKey = providerService.getRotatedApiKey(providerId)
  if (!apiKey.trim()) throw new PiMissingApiKeyError(providerId)
  return buildPiProviderInjection(provider, model, apiKey)
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

  // Unsupported beats missing-credential (parity with buildPiProviderInjection):
  // a login-based provider with no adapter has no key by design, and reporting
  // "missing API key" for it would misdiagnose an unsupported provider.
  if (!resolvePiApi(provider, model)) throw new PiUnsupportedProviderError(providerId)

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

function buildPiModelConfig(model: Model, id: string, api: PiApi): ProviderModelConfig {
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
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS
    // thinkingLevelMap intentionally omitted: Cherry does not wire pi
    // thinking-level control in v1 (see capability matrix).
  }
}
