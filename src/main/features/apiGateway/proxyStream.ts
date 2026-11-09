import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import type { UIMessageChunk } from 'ai'
import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveAiSdkProviderId, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import { SseListener, type StreamListener } from '@main/ai/streamManager'
import type { CallOverrides } from '@main/ai/types'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import type { ISseFormatter, IStreamAdapter } from './adapters'
import { MessageConverterFactory, StreamAdapterFactory } from './adapters'
import { buildStreamErrorFrame } from './errors'
import { resolveGatewayRequest, type MessageConfig } from './gatewayRequest'

export type { MessageConfig } from './gatewayRequest'
import { googleReasoningCache, openRouterReasoningCache } from './reasoningCache'
import { appendInternalAgentContinuation } from './utils/agentContinuation'
import { normalizeAnthropicToolHistory } from './utils/anthropicToolHistory'
import { positionInlineSystemMessages } from './utils/inlineSystemMessages'
import { applyAgentPromptCacheKey } from './utils/promptCacheKey'
import { sanitizeAnthropicRequestImages } from './utils/sanitizeAnthropicImages'

const logger = loggerService.withContext('ProxyStreamService')

const GATEWAY_STREAM_IDLE_TIMEOUT_MS = 20 * 60_000

type StartupState = 'pending' | 'committed' | 'abandoned' | 'failed'

const STARTUP_COMMIT_CHUNK_TYPES: ReadonlySet<UIMessageChunk['type']> = new Set([
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-input-available',
  'finish'
])

function isStartupCommitChunk(chunk: UIMessageChunk): boolean {
  return STARTUP_COMMIT_CHUNK_TYPES.has(chunk.type)
}

/**
 * Terminal error for a stream that paused without finishing — the 20-minute idle
 * timeout firing, or a mid-stream abort. `AiStreamManager` classifies both as
 * `paused` (not `error`), so the gateway must synthesize a failure: a 504 for the
 * non-streaming path and a dialect error frame for the streaming path. Without
 * this, a truncated reply is indistinguishable from a real completion.
 */
function streamInterruptedError(): Error & { status: number } {
  const error = new Error('Upstream idle timeout exceeded') as Error & {
    status: number
    cause?: string
  }
  error.status = 504
  error.cause = 'UPSTREAM_IDLE_TIMEOUT'
  return error
}

export async function processMessage(config: MessageConfig): Promise<Response> {
  const request = await resolveGatewayRequest(config)
  const {
    inputFormat,
    outputFormat,
    params,
    provider,
    model,
    resolvedModel,
    endpoint,
    isInternalAnthropicAgentRequest,
    isStreaming,
    agentSessionId,
    turnOptions,
    reasoning,
    uniqueModelId,
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
  const { onError, onComplete, signal } = config
  let effectiveParams = params

  if (isInternalAnthropicAgentRequest) {
    const anthropicParams = params as MessageCreateParams
    let messages = anthropicParams.messages
    const normalization = normalizeAnthropicToolHistory(messages)

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
      messages = normalization.messages
      logger.warn('Repaired duplicate tool history in internal Agent request', {
        ...logContext,
        duplicateToolUseCount: normalization.duplicateToolUseCount,
        duplicateToolResultCount: normalization.duplicateToolResultCount
      })
    }

    const imageSanitization = await sanitizeAnthropicRequestImages(messages)
    if (imageSanitization.replacedCount > 0) {
      messages = imageSanitization.messages
      logger.warn('Replaced undecodable image blocks in internal Agent request', {
        ...logContext,
        replacedCount: imageSanitization.replacedCount
      })
    }

    if (messages !== anthropicParams.messages) {
      effectiveParams = { ...anthropicParams, messages }
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

  // 4. Adapter + formatter translate UIMessageChunk → output format.
  const adapter: IStreamAdapter = StreamAdapterFactory.createAdapter(outputFormat, {
    model: `${provider.id}:${modelId}`,
    ...(converter.toClientToolName ? { toClientToolName: converter.toClientToolName.bind(converter) } : {})
  })
  const formatter: ISseFormatter = StreamAdapterFactory.getFormatter(outputFormat)
  const usageContext = config.requestHeaders
    ? application.get('ApiGatewayService').resolveAgentSessionUsage(config.requestHeaders, adapter.getMessageId())
    : undefined

  const streamId = `gateway-${uuidv4()}`
  if (messages !== convertedMessages) {
    logger.info('Appended assistant-tail continuation for internal agent request', { ...logContext, streamId })
  }
  const aiStreamManager = application.get('AiStreamManager')

  if (isStreaming) {
    // Do not commit the HTTP response until the provider has produced a meaningful
    // chunk. Adapters can emit protocol scaffolding for AI SDK `start` chunks.
    const encoder = new TextEncoder()
    let startupState: StartupState = 'pending'
    let resolveStartup!: () => void
    let rejectStartup!: (error: unknown) => void
    const startup = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve
      rejectStartup = reject
    })
    const bufferedFrames: Uint8Array[] = []
    let abortStream: (() => void) | undefined

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false

        const commit = () => {
          if (startupState !== 'pending') return
          startupState = 'committed'
          for (const frame of bufferedFrames) controller.enqueue(frame)
          bufferedFrames.length = 0
          resolveStartup()
        }
        const fail = (error: unknown) => {
          if (startupState !== 'pending') return
          startupState = 'failed'
          bufferedFrames.length = 0
          rejectStartup(error)
        }
        const abandon = () => {
          if (startupState !== 'pending') return
          startupState = 'abandoned'
          bufferedFrames.length = 0
          resolveStartup()
        }
        const safeClose = () => {
          if (closed) return
          closed = true
          signal?.removeEventListener('abort', onAbort)
          try {
            controller.close()
          } catch {
            // already closed
          }
        }
        const complete = () => {
          commit()
          safeClose()
          logger.info('Message completed', { ...logContext, streaming: true })
          onComplete?.()
        }
        const write = (data: string) => {
          if (closed) return
          const frame = encoder.encode(data)
          if (startupState === 'pending') bufferedFrames.push(frame)
          else if (startupState === 'committed') controller.enqueue(frame)
        }

        const onAbort = () => {
          abandon()
          aiStreamManager.abort(streamId, 'gateway client disconnected')
          safeClose()
        }
        abortStream = onAbort

        if (signal) {
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }

        const sseListener = new SseListener(write, complete, () => !closed, {
          id: `gateway:${streamId}`,
          // Commit before transforming a semantic chunk: adapter output for `start`
          // is protocol scaffolding, not proof that the provider has started.
          formatChunk: (chunk) => {
            if (isStartupCommitChunk(chunk)) commit()
            return adapter.transformChunk(chunk).map((event) => formatter.formatEvent(event))
          },
          formatDone: () =>
            adapter
              .finalizeEvents()
              .map((event) => formatter.formatEvent(event))
              .join('') + formatter.formatDone(),
          formatPaused: () => {
            logger.warn('Gateway stream paused before completion; emitting truncation error frame', {
              ...logContext,
              streamId
            })
            return buildStreamErrorFrame(outputFormat, streamInterruptedError())
          },
          formatError: (error) => {
            onError?.(error)
            return buildStreamErrorFrame(outputFormat, error)
          }
        })
        const listener: StreamListener = {
          id: sseListener.id,
          onChunk: (chunk) => {
            if (closed) return
            try {
              sseListener.onChunk(chunk)
            } catch (error) {
              if (startupState === 'pending') fail(error)
              else write(buildStreamErrorFrame(outputFormat, error))
              try {
                onError?.(error)
              } finally {
                safeClose()
                aiStreamManager.abort(streamId, 'gateway adapter rejected upstream output')
              }
            }
          },
          onDone: (result) => sseListener.onDone(result),
          onPaused: (result) => {
            if (startupState === 'pending') {
              fail(streamInterruptedError())
              complete()
              return
            }
            return sseListener.onPaused(result)
          },
          onError: (result) => {
            logger.warn('Gateway stream failed', { ...logContext, streamId, error: result.error })
            if (startupState !== 'pending') return sseListener.onError(result)

            fail(result.error)
            try {
              onError?.(result.error)
            } finally {
              complete()
            }
          },
          isAlive: () => sseListener.isAlive()
        }

        if (closed) return
        try {
          aiStreamManager.streamPrompt({
            ...turnOptions,
            streamId,
            uniqueModelId,
            resolvedModel,
            messages,
            listener,
            callOverrides,
            contextOwner: 'caller',
            ...(usageContext ? { usageContext } : {}),
            ...(agentSessionId ? { tokenUsageSource: 'agent' as const } : {}),
            idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS,
            // Serve exactly the admitted model; clients own retries, and fallbacks would bypass admission.
            maxRetries: 0
          })
        } catch (error) {
          fail(error)
          try {
            onError?.(error)
          } finally {
            safeClose()
          }
        }
      },
      cancel() {
        abortStream?.()
      }
    })

    const response = new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
    await startup
    return response
  }

  // Non-streaming: drive the adapter to accumulate state; respond with JSON at the end.
  // Terminal barrier: resolved on done/paused, rejected on error.
  let resolveDone!: () => void
  let rejectDone!: (error: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  let aborted = false
  let adapterFailed = false
  const onAbort = () => {
    aborted = true
    aiStreamManager.abort(streamId, 'gateway client disconnected')
    resolveDone()
  }
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  const listener: StreamListener = {
    id: `gateway:${streamId}`,
    onChunk: (chunk) => {
      if (adapterFailed) return
      try {
        adapter.transformChunk(chunk)
      } catch (error) {
        adapterFailed = true
        rejectDone(error)
        aiStreamManager.abort(streamId, 'gateway adapter rejected upstream output')
      }
    },
    onDone: () => resolveDone(),
    onPaused: () => {
      // Pause = idle-timeout / abort, not a clean completion. If the client
      // disconnected (`aborted`), the response is moot and `done` is already
      // resolved by `onAbort`; otherwise surface a 504 so a truncated reply is
      // not returned as a successful 200.
      if (aborted) {
        resolveDone()
        return
      }
      logger.warn('Gateway non-streaming request paused before completion (idle timeout)', {
        ...logContext,
        streamId
      })
      rejectDone(streamInterruptedError())
    },
    onError: (result) => rejectDone(result.error),
    isAlive: () => !aborted && !adapterFailed
  }

  try {
    if (!aborted) {
      aiStreamManager.streamPrompt({
        ...turnOptions,
        streamId,
        uniqueModelId,
        resolvedModel,
        messages,
        listener,
        callOverrides,
        contextOwner: 'caller',
        ...(usageContext ? { usageContext } : {}),
        ...(agentSessionId ? { tokenUsageSource: 'agent' as const } : {}),
        idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS,
        maxRetries: 0
      })
    }

    await done

    // Flush the adapter's finalize step, then emit the accumulated response.
    adapter.finalizeEvents()

    logger.info('Message completed', { ...logContext, streaming: false })
    onComplete?.()

    return new Response(JSON.stringify(adapter.buildNonStreamingResponse()), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    logger.error('Error in message processing', error as Error, logContext)
    onError?.(error)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
