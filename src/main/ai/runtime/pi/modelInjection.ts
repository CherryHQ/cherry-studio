import type { ProviderConfig, ProviderModelConfig } from '@earendil-works/pi-coding-agent'

import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { isPiCompatibleModel, mapEndpointToPiApi, type PiApi } from '@shared/ai/piModelCompatibility'
import { ENDPOINT_TYPE, type EndpointType, MODALITY, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { getRawModelId } from '@shared/utils/model'
import { resolveEndpointDialect } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import { resolveAgentContextWindow } from '../agentContextWindow'
import { projectPiReasoningCompat } from './piReasoningCompat'

type PiChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>

// Pi interpolates configured keys; supply the gateway key through runtime credentials instead.
export const PI_PLACEHOLDER_API_KEY = 'cherry-managed-runtime-key'
const DEFAULT_MAX_TOKENS = 8_192

export class PiUnsupportedProviderError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`Provider "${providerId}" cannot be routed through the internal gateway for pi agents`)
    this.name = 'PiUnsupportedProviderError'
    this.providerId = providerId
  }
}

export interface PiGatewayProviderInjection {
  providerName: string
  api: PiApi
  providerConfig: ProviderConfig & { models?: PiChatModelConfig[] }
  /** Internal gateway credential, supplied through ModelRuntime.setRuntimeApiKey. */
  apiKey: string
  modelId: string
}

function resolvePiEndpoint(provider: Provider, model: Model) {
  const preferredEndpoint =
    model.endpointTypes?.includes(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) &&
    model.endpointTypes.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
      ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      : undefined
  return resolveEffectiveEndpoint(provider, model, preferredEndpoint)
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
  if (!isPiCompatibleModel(provider, model)) throw new PiUnsupportedProviderError(provider.id)
  const gatewayApi = api ?? 'openai-completions'

  const modelId = formatGatewayModelId(provider.id, getRawModelId(model))
  const modelConfig = buildPiModelConfig(provider, model, modelId, gatewayApi, resolvedEndpoint.endpointType)
  const headers = Object.keys(gateway.usageHeaders).length ? gateway.usageHeaders : undefined

  return {
    providerName: provider.id,
    api: gatewayApi,
    providerConfig: {
      name: provider.name,
      baseUrl: formatPiBaseUrl(gateway.baseUrl, gatewayApi),
      apiKey: PI_PLACEHOLDER_API_KEY,
      api: gatewayApi,
      ...(headers ? { headers } : {}),
      models: [modelConfig]
    },
    apiKey: gateway.apiKey,
    modelId
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
  }
}

/** pi's thinking ladder. `off` is its name for Cherry's `none`; the rest share Cherry's spelling. */
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

// Pi clamps its default against this ladder; strict endpoints reject undeclared tiers.
// Toggle-only models need no map, since an all-null ladder would disable thinking.
function buildThinkingLevelMap(model: Model): PiChatModelConfig['thinkingLevelMap'] | undefined {
  const declared = model.reasoning?.selectableEfforts ?? []
  if (!declared.some((effort) => effort !== 'none' && effort !== 'auto')) return undefined

  const map: NonNullable<PiChatModelConfig['thinkingLevelMap']> = {}
  for (const level of PI_THINKING_LEVELS) {
    const effort = level === 'off' ? 'none' : level
    map[level] = declared.includes(effort) ? effort : null
  }
  return map
}

function buildPiModelConfig(
  provider: Provider,
  model: Model,
  id: string,
  api: PiApi,
  endpointType: EndpointType | undefined
): PiChatModelConfig {
  const input: ('text' | 'image')[] = ['text']
  const supportsImage =
    model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) ||
    (model.inputModalities?.includes(MODALITY.IMAGE) ?? false)
  if (supportsImage) {
    input.push('image')
  }
  const thinkingLevelMap = buildThinkingLevelMap(model)
  const reasoningCompat =
    api === 'anthropic-messages'
      ? projectPiReasoningCompat(providerRegistryService.resolveReasoningProfile(provider, model, endpointType))
      : {}
  const compat = {
    // Cherry's endpoint capability overrides pi's URL-based developer-role inference.
    ...(api === 'openai-completions' || api === 'openai-responses'
      ? { supportsDeveloperRole: resolveEndpointDialect(provider, endpointType).developerRole }
      : {}),
    // CherryIN can omit the signature delta on thinking blocks that must be replayed.
    ...(provider.id === 'cherryin' && api === 'anthropic-messages' ? { allowEmptySignature: true } : {}),
    ...reasoningCompat
  }

  return {
    id,
    name: model.name,
    api,
    reasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input,
    // pi tracks per-token cost for its own UI; Cherry owns cost accounting, so
    // leave zeros — pi's tracking is unused here.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: resolveAgentContextWindow(model),
    maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    ...(Object.keys(compat).length > 0 ? { compat } : {})
  }
}
