/**
 * Endpoint + AI SDK provider id resolution — single source of truth.
 *
 * Cherry Studio's v2 schema models multi-endpoint providers explicitly
 * (`Provider.endpointConfigs: Record<EndpointType, EndpointConfig>` +
 * `Provider.defaultChatEndpoint`), and individual models may pin a specific
 * endpoint via `model.endpointTypes[0]`. This module exposes the three
 * pure helpers every caller needs to navigate that data:
 *
 *  - `resolveEffectiveEndpoint(provider, model)` — picks the endpoint that
 *    the SDK call WILL actually hit, given the request shape.
 *  - `resolveProviderVariant(baseProviderId, endpointType)` — given a base
 *    ai-sdk extension id, returns the specific variant id ai-core exposes
 *    (e.g. `openai` + `openai-chat-completions` → `openai-chat`).
 *  - `resolveAiSdkProviderId(provider, endpointType)` — the unified
 *    provider-id resolver. Mirrors the resolution that already happens
 *    inside `providerToAiSdkConfig`, so feature gates can ask the SAME
 *    question without going through full config construction.
 *
 * Before this module existed, `getAiSdkProviderId(provider)` (factory.ts)
 * was endpoint-blind and `providerToAiSdkConfig` had its own private copy
 * of the endpoint resolution. Feature gates that needed the "real" id had
 * no good answer, so they gated on provider id alone and broke for
 * multi-endpoint providers (MiniMax: same provider has openai-chat-completions
 * AND anthropic-messages endpoints — the right feature set depends on which
 * is in use).
 */

import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { type AppProviderId, appProviderIds } from '../types'
import { getBaseUrl } from '../utils/provider'

export interface ResolvedEndpoint {
  /** The endpoint type the call will actually hit; `undefined` only when neither model nor provider declares one. */
  endpointType: EndpointType | undefined
  /** Base URL for that endpoint (empty string if no config matched). */
  baseUrl: string
}

/**
 * Resolve the effective endpoint type + base URL for a (provider, model) pair.
 *
 * Priority chain:
 *   1. `model.endpointTypes[0]` — relay-provider model annotation (highest
 *      precedence — the model itself says "call me via this endpoint").
 *   2. `provider.defaultChatEndpoint` — provider-level default.
 *   3. `undefined` — caller fall-through (e.g. `providerToAiSdkConfig`
 *      handles this by passing `endpointType: undefined` into downstream
 *      builders).
 *
 * The base URL is read through `getBaseUrl(provider, endpointType)` which
 * applies its own fallback among `endpointConfigs`.
 */
export function resolveEffectiveEndpoint(provider: Provider, model: Model): ResolvedEndpoint {
  const modelEndpoint = model.endpointTypes?.[0]
  const providerDefault = provider.defaultChatEndpoint
  const endpointType = modelEndpoint ?? providerDefault
  return { endpointType, baseUrl: getBaseUrl(provider, endpointType) }
}

/**
 * Given a base ai-sdk provider id, return the variant id that matches the
 * intended endpoint type. ai-core registers variants like `openai-chat` and
 * `openai-responses` separately from the base `openai`; some bases (e.g.
 * `deepseek`) have no variants and stay as-is.
 */
export function resolveProviderVariant(
  baseProviderId: AppProviderId,
  endpointType: EndpointType | undefined
): AppProviderId {
  if (!endpointType) return baseProviderId

  if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    const chatVariant = `${baseProviderId}-chat`
    if (chatVariant in appProviderIds) return appProviderIds[chatVariant]
  }

  if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
    const responsesVariant = `${baseProviderId}-responses`
    if (responsesVariant in appProviderIds) return appProviderIds[responsesVariant]
  }

  return baseProviderId
}

/**
 * Resolve the AI SDK provider id that will actually be used for a
 * (provider, endpointType) pair.
 */
export function resolveAiSdkProviderId(provider: Provider, endpointType: EndpointType | undefined): AppProviderId {
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}
