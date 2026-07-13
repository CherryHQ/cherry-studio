import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import {
  AGENT_FAST_MODE_HEADER,
  AGENT_REASONING_EFFORT_HEADER,
  type AgentRuntimeOptions
} from '@shared/ai/agentRuntimeOptions'
import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import {
  isExternalCliProvider,
  isGeminiProvider,
  isOllamaProvider,
  OLLAMA_PLACEHOLDER_AUTH_TOKEN
} from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import type { WarmQueryRequest } from './ClaudeCodeWarmQueryManager'
import { withDeepSeek1mSuffix } from './deepseekContext'
import { createClaudeCodeQueryOptions } from './queryOptions'
import { buildClaudeCodeSessionSettings } from './settingsBuilder'
import type { ClaudeCodeSettings } from './types'

export interface ClaudeCodeAgentSessionQueryRequest extends WarmQueryRequest {
  settings: ClaudeCodeSettings
  sdkModelId: string
}

interface RuntimeModelRef {
  providerId: string
  modelId: string
  apiModelId: string
  provider?: Provider
}

interface ClaudeCodeRuntimeRoute {
  baseUrl?: string
  apiKey?: string
  modelIds: {
    primary: string
    opus: string
    sonnet: string
    haiku: string
  }
}

export async function buildClaudeCodeQueryRequestForAgentSession(
  sessionId: string,
  effectiveResume?: string,
  /** Connection-scoped model override: a live turn runs on the model captured at its creation,
   *  which may differ from the agent's latest model after a mid-window edit. Defaults to the
   *  agent's current model (prewarm and turn-less connections). */
  connectionModelId?: UniqueModelId,
  runtimeOptions?: AgentRuntimeOptions
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined

  const uniqueModelId = connectionModelId ?? agent.model
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  // A live turn's connection is pinned to the model captured at turn creation, which can already be an
  // edit behind `agent.model`. The turn captured only its primary, so when the primary is a pre-edit
  // capture (the effective model differs from the latest `agent.model`), pin plan/small to it too rather
  // than read the possibly-edited-ahead latest sub-models — otherwise the captured turn would launch with
  // the old ANTHROPIC_MODEL but new sonnet/haiku defaults, or be forced onto the gateway by a sub-model
  // that now points at another provider. With no edit (or a turn-less connection) the latest sub-models
  // still apply.
  const pinSubModelsToPrimary = uniqueModelId !== agent.model
  const planModel = pinSubModelsToPrimary ? undefined : agent.planModel
  const smallModel = pinSubModelsToPrimary ? undefined : agent.smallModel
  const route = await resolveClaudeCodeRuntimeRoute(provider, model, modelId, baseUrl, planModel, smallModel)
  const resumeSessionId =
    effectiveResume ?? agentSessionMessageService.getLastRuntimeResumeToken(session.id) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(session, provider, {
      lastAgentSessionId: resumeSessionId,
      fastMode: isClaudeCodeProviderId(providerId) ? runtimeOptions?.fastMode : undefined,
      thinkingOptions: runtimeOptions
        ? {
            effort: runtimeOptions.reasoningEffort === 'xhigh' ? 'max' : runtimeOptions.reasoningEffort
          }
        : undefined
    }),
    route,
    providerId,
    runtimeOptions
  )
  const sdkModelId = route.modelIds.primary
  const options = createClaudeCodeQueryOptions({
    modelId: sdkModelId,
    settings,
    effectiveResume: resumeSessionId ?? settings.resume
  })

  if (options.includePartialMessages === undefined) {
    options.includePartialMessages = true
  }

  return {
    key: settings.warmQueryKey ?? session.id,
    options,
    initializeTimeoutMs: settings.warmQueryInitializeTimeoutMs,
    settings,
    sdkModelId
  }
}

async function resolveClaudeCodeRuntimeRoute(
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string,
  planModel: UniqueModelId | null | undefined,
  smallModel: UniqueModelId | null | undefined
): Promise<ClaudeCodeRuntimeRoute> {
  const primaryRef: RuntimeModelRef = {
    providerId: primaryProvider.id,
    modelId: primaryModelId,
    apiModelId: primaryModel.apiModelId ?? primaryModelId,
    provider: primaryProvider
  }
  const opusRef = primaryRef
  // Unset plan/small models fall back to `primaryRef` (the effective connection model). The caller also
  // passes them unset to pin a captured turn's route to its primary (see `pinSubModelsToPrimary`), so a
  // mid-window sub-model edit can't mix into the captured connection — the whole route stays on the pinned
  // model (consistent env values, no spurious gateway switch when the edit points at another provider).
  const sonnetRef = resolveRuntimeModelRef(planModel, primaryRef)
  const haikuRef = resolveRuntimeModelRef(smallModel, primaryRef)
  const modelRefs = [primaryRef, opusRef, sonnetRef, haikuRef]

  const geminiRef = modelRefs.find((ref) => ref.provider && isGeminiProvider(ref.provider))
  if (geminiRef) {
    throw new Error(`Gemini provider models are not supported by Claude Code agents: ${geminiRef.providerId}`)
  }

  // External-cli (e.g. claude-code) authenticates only through the SDK's
  // subscription login, which can serve *only* this provider's own models. A
  // plan/small model pointing at another provider can't run on that login — and
  // must not fall through to the gateway branch below, which would inject an API
  // key (abandoning the login) and ship an unresolvable `claude-code:*` id to
  // the gateway, bricking the agent. Pin every sub-model back onto the primary
  // so the agent still runs on the subscription login.
  if (isExternalCliProvider(primaryProvider)) {
    const pinToPrimary = (ref: RuntimeModelRef) =>
      ref.providerId === primaryProvider.id ? ref.apiModelId : primaryRef.apiModelId
    return {
      modelIds: {
        primary: primaryRef.apiModelId,
        opus: pinToPrimary(opusRef),
        sonnet: pinToPrimary(sonnetRef),
        haiku: pinToPrimary(haikuRef)
      }
    }
  }

  const shouldUseGateway = modelRefs.some(
    (ref) => ref.providerId !== primaryProvider.id || !ref.provider || !supportsAnthropicMessages(ref.provider)
  )

  if (shouldUseGateway) {
    const gateway = await resolveApiGatewayRuntime()
    return {
      baseUrl: gateway.baseUrl,
      apiKey: gateway.apiKey,
      modelIds: {
        primary: toGatewayModelId(primaryRef),
        opus: toGatewayModelId(opusRef),
        sonnet: toGatewayModelId(sonnetRef),
        haiku: toGatewayModelId(haikuRef)
      }
    }
  }

  const anthropicBaseUrl = resolveAnthropicBaseUrl(primaryProvider, primaryBaseUrl)
  const providerApiKey = providerService.getRotatedApiKey(primaryProvider.id)
  const runtimeApiKey = providerApiKey || (isOllamaProvider(primaryProvider) ? OLLAMA_PLACEHOLDER_AUTH_TOKEN : '')
  return {
    baseUrl: anthropicBaseUrl,
    apiKey: runtimeApiKey,
    modelIds: {
      primary: withDeepSeek1mSuffix(primaryRef.apiModelId, anthropicBaseUrl),
      opus: withDeepSeek1mSuffix(opusRef.apiModelId, anthropicBaseUrl),
      sonnet: withDeepSeek1mSuffix(sonnetRef.apiModelId, anthropicBaseUrl),
      haiku: withDeepSeek1mSuffix(haikuRef.apiModelId, anthropicBaseUrl)
    }
  }
}

function resolveRuntimeModelRef(
  uniqueModelId: UniqueModelId | null | undefined,
  fallback: RuntimeModelRef
): RuntimeModelRef {
  if (!uniqueModelId) return fallback
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  if (providerId === fallback.providerId && modelId === fallback.modelId) return fallback

  try {
    let provider: ReturnType<typeof providerService.getByProviderId> | undefined
    try {
      provider = providerService.getByProviderId(providerId)
    } catch {
      provider = undefined
    }
    let model: ReturnType<typeof modelService.getByKey> | undefined
    try {
      model = modelService.getByKey(providerId, modelId)
    } catch {
      model = undefined
    }
    return {
      providerId,
      modelId,
      apiModelId: model?.apiModelId ?? modelId,
      provider
    }
  } catch {
    return { providerId, modelId, apiModelId: modelId }
  }
}

function supportsAnthropicMessages(provider: Provider): boolean {
  return (
    provider.id === 'anthropic' ||
    provider.presetProviderId === 'anthropic' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ||
    Object.prototype.hasOwnProperty.call(provider.endpointConfigs ?? {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  )
}

async function resolveApiGatewayRuntime(): Promise<{ baseUrl: string; apiKey: string }> {
  const apiGatewayService = application.get('ApiGatewayService')
  const apiKey = await apiGatewayService.ensureValidApiKey()
  if (!apiGatewayService.isRunning()) {
    await apiGatewayService.start()
  }
  const config = apiGatewayService.getCurrentConfig()
  const host = config.host || '127.0.0.1'
  const port = config.port || 23333
  return { baseUrl: `http://${host}:${port}`, apiKey }
}

function toGatewayModelId(ref: RuntimeModelRef): string {
  if (isManagedCherryAiDefaultModel(ref.providerId, ref.apiModelId)) {
    throw new Error('CherryAI managed default model is not available through the API gateway')
  }
  return `${ref.providerId}:${ref.apiModelId}`
}

function resolveAnthropicBaseUrl(provider: Provider, baseUrl: string) {
  // Claude SDK manages API versioning itself — ANTHROPIC_BASE_URL must not include /v1.
  const anthropicEndpointUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const rawBaseUrl = anthropicEndpointUrl || baseUrl
  return rawBaseUrl ? withoutTrailingApiVersion(formatApiHost(rawBaseUrl, false)) : undefined
}

function mergeRuntimeSettings(
  settings: ClaudeCodeSettings,
  route: ClaudeCodeRuntimeRoute,
  providerId: string,
  runtimeOptions?: AgentRuntimeOptions
): ClaudeCodeSettings {
  const agentHeaders =
    isCodexProviderId(providerId) && runtimeOptions
      ? [
          `${AGENT_REASONING_EFFORT_HEADER}: ${runtimeOptions.reasoningEffort}`,
          `${AGENT_FAST_MODE_HEADER}: ${runtimeOptions.fastMode}`
        ].join('\n')
      : undefined
  return {
    ...settings,
    env: {
      ...settings.env,
      ANTHROPIC_MODEL: route.modelIds.primary,
      ANTHROPIC_DEFAULT_OPUS_MODEL: route.modelIds.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: route.modelIds.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: route.modelIds.haiku,
      ...(route.apiKey ? { ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_AUTH_TOKEN: route.apiKey } : {}),
      ...(route.baseUrl ? { ANTHROPIC_BASE_URL: route.baseUrl } : {}),
      ...(agentHeaders
        ? {
            ANTHROPIC_CUSTOM_HEADERS: [settings.env?.ANTHROPIC_CUSTOM_HEADERS, agentHeaders].filter(Boolean).join('\n')
          }
        : {})
    }
  }
}

export async function buildClaudeCodeWarmQueryRequestForAgentSession(
  sessionId: string
): Promise<WarmQueryRequest | undefined> {
  const request = await buildClaudeCodeQueryRequestForAgentSession(sessionId)
  if (!request) return undefined
  return {
    key: request.key,
    options: request.options,
    initializeTimeoutMs: request.initializeTimeoutMs
  }
}
