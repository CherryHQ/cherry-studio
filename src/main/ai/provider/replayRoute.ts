import { createHash } from 'node:crypto'

import type { LanguageModelV3Message, LanguageModelV3Prompt } from '@ai-sdk/provider'

import { resolveAihubmixChatRoute, resolveDmxapiChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import { isDeepSeekModel } from '@shared/utils/model'

import type { SdkConfig } from './sdkConfig'

export function getReplayEndpoint(
  endpoint: EndpointType | undefined,
  config: Pick<SdkConfig, 'providerId' | 'modelId'>
) {
  if (config.providerId === 'aihubmix') return resolveAihubmixChatRoute(config.modelId).endpointType
  if (config.providerId === 'dmxapi') return resolveDmxapiChatRoute(config.modelId).endpointType
  if (config.providerId === 'google-vertex-maas') return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  return endpoint
}

export function needsPlainToolReasoning(endpoint: EndpointType | undefined, model: Model) {
  return (
    (endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES) &&
    isDeepSeekModel(model)
  )
}

export function getReplayRouteId(
  connectionId: string,
  endpoint: EndpointType | undefined,
  config: Pick<SdkConfig, 'providerId' | 'modelId' | 'providerSettings'>
): string {
  const endpointType = getReplayEndpoint(endpoint, config)
  const settings = config.providerSettings
  const geminiUrl =
    endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && 'geminiBaseURL' in settings
      ? settings.geminiBaseURL
      : undefined
  const anthropicUrl =
    endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES && 'anthropicBaseURL' in settings
      ? settings.anthropicBaseURL
      : undefined
  const endpointUrl =
    endpointType && 'endpointBaseURLs' in settings ? settings.endpointBaseURLs?.[endpointType] : undefined
  const configuredUrl =
    geminiUrl ||
    anthropicUrl ||
    endpointUrl ||
    ('baseURL' in settings ? settings.baseURL : undefined) ||
    ('url' in settings ? settings.url : undefined)
  const url = typeof configuredUrl === 'string' ? URL.parse(configuredUrl) : null
  const route = [
    connectionId,
    endpointType,
    config.providerId,
    config.modelId,
    url?.origin,
    url?.pathname.replace(/\/+$/, ''),
    url?.searchParams.get('api-version') ?? ('apiVersion' in settings ? settings.apiVersion : undefined),
    'project' in settings ? settings.project : undefined,
    'location' in settings ? settings.location : undefined
  ]
  return createHash('sha256').update(JSON.stringify(route)).digest('hex')
}

export class ToolContinuationRouteError extends Error {
  constructor() {
    super('The route required to continue this tool call is unavailable. The tool results were retained.')
    this.name = 'ToolContinuationRouteError'
  }
}

export function selectToolContinuation<Source>(
  steps: Iterable<{ source: Source; toolCallIds: readonly string[]; requiredRoutes: readonly string[] }>,
  completedCalls: ReadonlySet<string>
): { source: Source; routeId: string } | undefined {
  let pending: { source: Source; routeId: string } | undefined
  for (const { source, toolCallIds, requiredRoutes } of steps) {
    if (!toolCallIds.some((id) => completedCalls.has(id))) continue
    for (const routeId of requiredRoutes) {
      if (pending && pending.routeId !== routeId) throw new ToolContinuationRouteError()
      pending = { source, routeId }
    }
  }
  return pending
}

export function isReplayUserMessage(
  message: LanguageModelV3Message
): message is Extract<LanguageModelV3Message, { role: 'user' }> {
  return message.role === 'user' && message.providerOptions?.cherry?.toolResultMedia !== true
}

export function getPendingReplayRoute(prompt: LanguageModelV3Prompt): string | undefined {
  const active = prompt.slice(prompt.findLastIndex(isReplayUserMessage) + 1)
  const completedCalls = new Set(
    active.flatMap((message) =>
      message.role === 'tool'
        ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : []))
        : []
    )
  )
  const steps = active
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      source: message,
      toolCallIds: message.content.flatMap((part) =>
        part.type === 'tool-call' && !part.providerExecuted ? [part.toolCallId] : []
      ),
      requiredRoutes: message.content.flatMap((part) => {
        const source = part.providerOptions?.cherry?.replayRouteId
        return typeof source === 'string' && part.providerOptions?.cherry?.replayRequiresRoute !== false ? [source] : []
      })
    }))
  return selectToolContinuation(steps, completedCalls)?.routeId
}
