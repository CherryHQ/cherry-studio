import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'

import { loggerService } from '@logger'
import { resolveAiSdkProviderId, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import { ToolContinuationRouteError } from '@main/ai/provider/replayRoute'
import type { CallOverrides, InProcessUsageContext } from '@main/ai/types'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { MessageConverterFactory, type StreamAdapterOptions } from './adapters'
import { readClaudeCodeReplay, saveClaudeCodeReplay } from './claudeCodeReplay'
import { type MessageConfig, readGatewayRequest, resolveGatewayRequest } from './gatewayRequest'
import { googleReasoningCache, openRouterReasoningCache } from './reasoningCache'
import { GATEWAY_STREAM_IDLE_TIMEOUT_MS } from './streamLifecycle'
import { appendInternalAgentContinuation } from './utils/agentContinuation'
import { normalizeAnthropicToolHistory } from './utils/anthropicToolHistory'
import { positionInlineSystemMessages } from './utils/inlineSystemMessages'
import { applyAgentPromptCacheKey } from './utils/promptCacheKey'

const logger = loggerService.withContext('GatewayMessage')

export async function prepareGatewayMessage(config: MessageConfig) {
  const incoming = readGatewayRequest(config)
  const { params, inputFormat, outputFormat, isInternalAnthropicAgentRequest, agentSessionId, asClientError } = incoming
  let effectiveParams = params
  const normalization = isInternalAnthropicAgentRequest
    ? normalizeAnthropicToolHistory((params as MessageCreateParams).messages)
    : undefined

  if (normalization?.status === 'conflict') {
    logger.warn('Rejected conflicting tool history in internal Agent request', {
      modelAddress: incoming.modelString,
      agentSessionId,
      toolUseId: normalization.toolUseId,
      reason: normalization.reason,
      firstLocation: normalization.firstLocation,
      duplicateLocation: normalization.duplicateLocation
    })
    throw asClientError(new Error('Invalid Anthropic tool history: tool_use ids must be unique'))
  }

  if (normalization?.status === 'repaired') {
    effectiveParams = { ...(params as MessageCreateParams), messages: normalization.messages }
  }

  const claudeCodeSession =
    isInternalAnthropicAgentRequest && outputFormat === 'anthropic' && !config.agentContext ? agentSessionId : undefined
  const replay = claudeCodeSession
    ? readClaudeCodeReplay(claudeCodeSession, (effectiveParams as MessageCreateParams).messages)
    : undefined
  const request = await resolveGatewayRequest(config, incoming, replay?.continuation).catch((error: unknown) => {
    if (replay?.continuation) throw asClientError(new ToolContinuationRouteError())
    throw error
  })
  const { provider, model, endpoint, reasoning, modelId, modelAddress, logContext } = request
  const internal = request.isInternalRequest
  if (normalization?.status === 'repaired') {
    logger.warn('Repaired duplicate tool history in internal Agent request', {
      ...logContext,
      duplicateToolUseCount: normalization.duplicateToolUseCount,
      duplicateToolResultCount: normalization.duplicateToolResultCount
    })
  }
  logger.info('Converting gateway protocol request', {
    ...logContext,
    mode: 'sdk',
    inputFormat,
    target: endpoint.endpointType,
    outputFormat
  })

  // 2. Build converter and extract messages / tools / sampling / provider options.
  const converter = MessageConverterFactory.create(
    inputFormat,
    replay ? { getReplayMetadata: replay.getMetadata } : { googleReasoningCache, openRouterReasoningCache }
  )

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
  const omitSignatures = config.agentContext?.omitGeminiSignaturesFor
  if (inputFormat === 'gemini' && omitSignatures?.size) {
    // Native Gemini can omit or normalize call IDs. The converter preserves call order.
    let ordinal = 0
    for (const message of convertedMessages) {
      for (const part of message.parts) {
        if (
          part.type === 'dynamic-tool' &&
          omitSignatures.has(ordinal++) &&
          !part.callProviderMetadata?.google?.thoughtSignature
        ) {
          part.callProviderMetadata = {
            ...part.callProviderMetadata,
            cherry: { ...part.callProviderMetadata?.cherry, omitGeminiThoughtSignature: true }
          }
        }
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

  // Provider options (reasoning/thinking) use the same enabled provider resolved above.
  const extractedProviderOptions =
    converter.extractProviderOptions(
      provider,
      model,
      effectiveParams,
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

  const adapterOptions: StreamAdapterOptions = {
    model: `${provider.id}:${modelId}`,
    ...(claudeCodeSession && {
      captureReplay: (blocks) => saveClaudeCodeReplay(claudeCodeSession, modelAddress, endpoint.endpointType, blocks)
    }),
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
    ...(request.adapterOptions.captureReplay && { replayProviderState: true }),
    ...(usageContext ? { usageContext } : {}),
    ...(request.agentSessionId ? { tokenUsageSource: 'agent' as const } : {}),
    idleTimeoutMs,
    maxRetries: 0 as const
  }
}
