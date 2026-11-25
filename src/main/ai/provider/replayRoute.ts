import { createHash } from 'node:crypto'

import type { LanguageModelV3Prompt } from '@ai-sdk/provider'

import { resolveAihubmixChatRoute, resolveDmxapiChatRoute } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import { isDeepSeekModel } from '@shared/utils/model'

import type { SdkConfig } from './sdkConfig'

export function getReplayEndpoint(endpoint: EndpointType | undefined, config: SdkConfig) {
  if (config.providerId === 'aihubmix') return resolveAihubmixChatRoute(config.modelId).endpointType
  if (config.providerId === 'dmxapi') return resolveDmxapiChatRoute(config.modelId).endpointType
  return endpoint
}

export function needsPlainToolReasoning(endpoint: EndpointType | undefined, model: Model) {
  return (
    (endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES) &&
    isDeepSeekModel(model)
  )
}

export function getReplayRouteId(connectionId: string, endpoint: EndpointType | undefined, config: SdkConfig): string {
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

export function getPendingReplayRoute(prompt: LanguageModelV3Prompt): string | undefined {
  const active = prompt.slice(prompt.findLastIndex((message) => message.role === 'user') + 1)
  const completedCalls = new Set(
    active.flatMap((message) =>
      message.role === 'tool'
        ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : []))
        : []
    )
  )
  let route: string | undefined
  for (const message of active) {
    if (
      message.role !== 'assistant' ||
      !message.content.some(
        (part) => part.type === 'tool-call' && !part.providerExecuted && completedCalls.has(part.toolCallId)
      )
    )
      continue
    for (const part of message.content) {
      const source = part.providerOptions?.cherry?.replayRouteId
      if (typeof source !== 'string' || part.providerOptions?.cherry?.replayRequiresRoute === false) continue
      if (route !== undefined && source !== route) throw new ToolContinuationRouteError()
      route = source
    }
  }
  return route
}
