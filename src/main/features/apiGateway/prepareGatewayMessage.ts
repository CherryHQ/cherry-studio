import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'

import { loggerService } from '@logger'
import { resolveMediaCapabilities } from '@main/ai/messages/messageCapabilities'
import { resolveAiSdkProviderId, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import type { CallOverrides, InProcessUsageContext } from '@main/ai/types'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { MessageConverterFactory } from './adapters'
import { resolveGatewayRequest, type MessageConfig } from './gatewayRequest'
import { googleReasoningCache, openRouterReasoningCache } from './reasoningCache'
import { GATEWAY_STREAM_IDLE_TIMEOUT_MS } from './streamLifecycle'
import { appendInternalAgentContinuation } from './utils/agentContinuation'
import { normalizeAnthropicToolHistory } from './utils/anthropicToolHistory'
import { positionInlineSystemMessages } from './utils/inlineSystemMessages'
import { applyAgentPromptCacheKey } from './utils/promptCacheKey'

const logger = loggerService.withContext('GatewayMessage')

export async function prepareGatewayMessage(config: MessageConfig) {
  const request = await resolveGatewayRequest(config)
  const {
    inputFormat,
    outputFormat,
    params,
    provider,
    model,
    endpoint,
    isInternalAnthropicAgentRequest,
    agentSessionId,
    reasoning,
    modelId,
    logContext,
    asClientError
  } = request
  logger.info('Converting gateway protocol request', {
    ...logContext,
    mode: 'sdk',
    inputFormat,
    target: endpoint.endpointType,
    outputFormat
  })
  const internal = request.isInternalRequest
  let effectiveParams = params

  if (isInternalAnthropicAgentRequest) {
    const anthropicParams = params as MessageCreateParams
    const normalization = normalizeAnthropicToolHistory(anthropicParams.messages)

    if (normalization.status === 'conflict') {
      logger.warn('Rejected conflicting tool history in internal Agent request', {
        ...logContext,
        toolUseId: normalization.toolUseId,
        reason: normalization.reason,
        firstLocation: normalization.firstLocation,
        duplicateLocation: normalization.duplicateLocation
      })
      throw asClientError(new Error('Invalid Anthropic tool history: tool_use ids must be unique'))
    }

    if (normalization.status === 'repaired') {
      effectiveParams = { ...anthropicParams, messages: normalization.messages }
      logger.warn('Repaired duplicate tool history in internal Agent request', {
        ...logContext,
        duplicateToolUseCount: normalization.duplicateToolUseCount,
        duplicateToolResultCount: normalization.duplicateToolResultCount
      })
    }
  }

  // 2. Build converter and extract messages / tools / sampling / provider options.
  const converter = MessageConverterFactory.create(inputFormat, {
    googleReasoningCache,
    openRouterReasoningCache
  })

  // These adapters derive instructions from messages and ignore the provider option.
  const instructionsInMessages = ['open-responses', 'xai-responses'].includes(
    resolveAiSdkProviderId(provider, endpoint.endpointType)
  )
  const responsesInstructions =
    inputFormat === 'openai-responses' &&
    !instructionsInMessages &&
    endpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES &&
    'instructions' in effectiveParams &&
    typeof effectiveParams.instructions === 'string'
      ? effectiveParams.instructions
      : undefined
  const convertedMessages = converter.toUIMessages(
    responsesInstructions !== undefined ? { ...effectiveParams, instructions: undefined } : effectiveParams
  )
  const media = resolveMediaCapabilities(model)
  for (const message of convertedMessages) {
    for (const part of message.parts) {
      if (part.type !== 'file') continue
      if (
        (part.mediaType.startsWith('image/') && !media.image) ||
        (part.mediaType.startsWith('audio/') && !media.audio) ||
        (part.mediaType.startsWith('video/') && !media.video)
      ) {
        throw new UnsupportedFunctionalityError({ functionality: `Model input media: ${part.mediaType}` })
      }
    }
  }
  // Leaving inline system messages in place is what keeps the prompt prefix cacheable
  // across turns; targets that reject them get a downgrade 400 or a fold.
  const positionedMessages = positionInlineSystemMessages(
    convertedMessages,
    endpoint.endpointType,
    config.requestHeaders
  )
  const messages = isInternalAnthropicAgentRequest
    ? appendInternalAgentContinuation(positionedMessages)
    : positionedMessages
  const tools = converter.toAiSdkTools?.(effectiveParams, endpoint.endpointType)
  const streamOptions = converter.extractStreamOptions(effectiveParams)
  if (
    endpoint.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES &&
    [streamOptions.seed, streamOptions.presencePenalty, streamOptions.frequencyPenalty].some(
      (value) => value !== undefined
    )
  ) {
    throw new UnsupportedFunctionalityError({ functionality: 'Seed/penalties on a Responses target' })
  }
  if (resolveAiSdkProviderId(provider, endpoint.endpointType) === 'open-responses' && streamOptions.output) {
    const format = await streamOptions.output.responseFormat
    if (format?.type === 'json' && !format.schema) {
      throw new UnsupportedFunctionalityError({
        functionality: 'JSON object mode in the pinned Open Responses adapter; supply a JSON schema'
      })
    }
  }

  // Provider options (reasoning/thinking) use the same enabled provider resolved above.
  const extractedProviderOptions =
    converter.extractProviderOptions(
      provider,
      model,
      request.turnOptions.serviceTier !== undefined
        ? { ...effectiveParams, service_tier: undefined, serviceTier: undefined }
        : effectiveParams,
      streamOptions.maxOutputTokens,
      reasoning.success
    ) ?? {}
  if (responsesInstructions !== undefined) {
    const key = resolveEndpointProviderOptionsKey(provider, endpoint)
    extractedProviderOptions[key] = { ...extractedProviderOptions[key], instructions: responsesInstructions }
  }
  const providerOptions = agentSessionId
    ? applyAgentPromptCacheKey(provider, model, extractedProviderOptions, agentSessionId)
    : extractedProviderOptions

  // 3. Assemble first-class per-request overrides (sampling / tools / provider options).
  const callOverrides: CallOverrides = {
    ...streamOptions,
    ...(tools ? { tools } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {})
  }

  const adapterOptions = {
    model: `${provider.id}:${modelId}`,
    ...(converter.toClientToolName ? { toClientToolName: converter.toClientToolName.bind(converter) } : {})
  }
  return { ...request, messages, convertedMessages, callOverrides, adapterOptions, internal }
}

export function gatewayPromptOptions(
  request: Awaited<ReturnType<typeof prepareGatewayMessage>>,
  usageContext: InProcessUsageContext | undefined,
  idleTimeoutMs = GATEWAY_STREAM_IDLE_TIMEOUT_MS
) {
  return {
    ...request.turnOptions,
    uniqueModelId: request.uniqueModelId,
    resolvedModel: request.resolvedModel,
    messages: request.messages,
    callOverrides: request.callOverrides,
    contextOwner: 'caller' as const,
    ...(usageContext ? { usageContext } : {}),
    ...(request.agentSessionId ? { tokenUsageSource: 'agent' as const } : {}),
    idleTimeoutMs,
    maxRetries: 0 as const
  }
}
