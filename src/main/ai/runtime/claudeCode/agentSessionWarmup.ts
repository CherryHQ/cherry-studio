import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost } from '@shared/utils/api'

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

export async function buildClaudeCodeQueryRequestForAgentSession(
  sessionId: string,
  effectiveResume?: string
): Promise<ClaudeCodeAgentSessionQueryRequest | undefined> {
  const session = await agentSessionService.getById(sessionId)
  if (!session?.agentId) return undefined

  const agent = await agentService.getAgent(session.agentId)
  if (!agent?.model) return undefined

  const uniqueModelId = agent.model
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = await providerService.getByProviderId(providerId)
  const model = await modelService.getByKey(providerId, modelId)
  const { baseUrl } = resolveEffectiveEndpoint(provider, model)
  const apiKey = await providerService.getRotatedApiKey(provider.id)
  const anthropicBaseUrl = resolveAnthropicBaseUrl(provider, baseUrl)
  const resumeSessionId =
    effectiveResume ?? (await agentSessionMessageService.getLastRuntimeResumeToken(session.id)) ?? undefined
  const settings = mergeRuntimeSettings(
    await buildClaudeCodeSessionSettings(session, provider, { lastAgentSessionId: resumeSessionId }),
    apiKey,
    anthropicBaseUrl
  )
  const sdkModelId = withDeepSeek1mSuffix(model.apiModelId ?? model.id, anthropicBaseUrl)
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

function resolveAnthropicBaseUrl(provider: Provider, baseUrl: string) {
  // Claude SDK manages API versioning itself — ANTHROPIC_BASE_URL must not include /v1.
  const anthropicEndpointUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  const rawBaseUrl = anthropicEndpointUrl || baseUrl
  return rawBaseUrl ? formatApiHost(rawBaseUrl, false) : undefined
}

function mergeRuntimeSettings(
  settings: ClaudeCodeSettings,
  apiKey: string | undefined,
  anthropicBaseUrl: string | undefined
): ClaudeCodeSettings {
  return {
    ...settings,
    env: {
      ...settings.env,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_AUTH_TOKEN: apiKey } : {}),
      ...(anthropicBaseUrl ? { ANTHROPIC_BASE_URL: anthropicBaseUrl } : {})
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
