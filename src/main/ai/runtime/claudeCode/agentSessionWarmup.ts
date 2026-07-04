import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { application } from '@main/core/application'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'
import { isExternalCliProvider, isGeminiProvider, isOllamaProvider } from '@shared/utils/provider'

import { resolveEffectiveEndpoint } from '../../provider/endpoint'
import type { WarmQueryRequest } from './ClaudeCodeWarmQueryManager'
import { withDeepSeek1mSuffix } from './deepseekContext'
import { createClaudeCodeQueryOptions } from './queryOptions'
import { buildClaudeCodeSessionSettings } from './settingsBuilder'
import type { ClaudeCodeSettings } from './types'

const OLLAMA_CLAUDE_CODE_AUTH_TOKEN = 'ollama'

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
  effectiveResume?: string
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined

  const uniqueModelId = agent.model
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  const route = await resolveClaudeCodeRuntimeRoute(agent, provider, model, modelId, baseUrl)
  const resumeSessionId =
    effectiveResume ?? agentSessionMessageService.getLastRuntimeResumeToken(session.id) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(session, provider, { lastAgentSessionId: resumeSessionId }),
    route
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
  agent: AgentEntity,
  primaryProvider: Provider,
  primaryModel: Model,
  primaryModelId: string,
  primaryBaseUrl: string
): Promise<ClaudeCodeRuntimeRoute> {
  const primaryRef: RuntimeModelRef = {
    providerId: primaryProvider.id,
    modelId: primaryModelId,
    apiModelId: primaryModel.apiModelId ?? primaryModelId,
    provider: primaryProvider
  }
  const opusRef = primaryRef
  const sonnetRef = resolveRuntimeModelRef(agent.planModel ?? agent.model, primaryRef)
  const haikuRef = resolveRuntimeModelRef(agent.smallModel ?? agent.model, primaryRef)
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
  const runtimeApiKey = providerApiKey || (isOllamaProvider(primaryProvider) ? OLLAMA_CLAUDE_CODE_AUTH_TOKEN : '')
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

function mergeRuntimeSettings(settings: ClaudeCodeSettings, route: ClaudeCodeRuntimeRoute): ClaudeCodeSettings {
  return {
    ...settings,
    env: {
      ...settings.env,
      ANTHROPIC_MODEL: route.modelIds.primary,
      ANTHROPIC_DEFAULT_OPUS_MODEL: route.modelIds.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: route.modelIds.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: route.modelIds.haiku,
      ...(route.apiKey ? { ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_AUTH_TOKEN: route.apiKey } : {}),
      ...(route.baseUrl ? { ANTHROPIC_BASE_URL: route.baseUrl } : {})
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
