/**
 * Proxy Stream Service
 *
 * Routes API-gateway requests through main's `AiStreamManager` as an equal
 * subscriber (alongside WebContentsListener / ChannelAdapterListener), using a
 * one-shot non-persisting prompt stream. The resulting `UIMessageChunk` stream
 * is translated into each API's SSE / JSON shape by the adapter system, driven
 * from the listener via the adapter's push API.
 *
 * The gateway is assistant-agnostic: per-request sampling, client tools, and
 * provider options are passed as first-class `callOverrides` on the stream
 * request (merged at highest precedence inside `buildAgentParams`).
 *
 * Output is a Web-standard `Response`: streaming requests return a
 * `text/event-stream` `ReadableStream`; non-streaming requests return a JSON
 * `Response`. The Elysia route handlers return this `Response` directly.
 */

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { SseListener } from '@main/ai/streamManager'
import type { StreamListener } from '@main/ai/streamManager/types'
import type { CallOverrides } from '@main/ai/types/requests'
import { application } from '@main/core/application'
import { createUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { v4 as uuidv4 } from 'uuid'

import type { InputFormat, InputParamsMap, ISseFormatter, IStreamAdapter, OutputFormat } from './adapters'
import { MessageConverterFactory, StreamAdapterFactory } from './adapters'
import { buildStreamErrorFrame } from './errors'
import { googleReasoningCache, openRouterReasoningCache } from './reasoningCache'

const logger = loggerService.withContext('ProxyStreamService')

const GATEWAY_STREAM_IDLE_TIMEOUT_MS = 20 * 60_000

/**
 * Terminal error for a stream that paused without finishing — the 20-minute idle
 * timeout firing, or a mid-stream abort. `AiStreamManager` classifies both as
 * `paused` (not `error`), so the gateway must synthesize a failure: a 504 for the
 * non-streaming path and a dialect error frame for the streaming path. Without
 * this, a truncated reply is indistinguishable from a real completion.
 */
function streamInterruptedError(): Error & { status: number } {
  const error = new Error('Upstream stream ended before completion (idle timeout or abort)') as Error & {
    status: number
  }
  error.status = 504
  return error
}

/** Union of all supported input params. */
type InputParams = InputParamsMap[InputFormat]

/**
 * Configuration for a gateway message request (streaming or non-streaming).
 * Routes pass `{ params, inputFormat, outputFormat, signal }`.
 */
export interface MessageConfig {
  provider?: Provider
  modelId?: string
  /**
   * The loosely-validated gateway request body. Routes validate only the fields
   * the gateway needs (`model`, `messages`/`input`, …) and pass the rest through,
   * so this is `unknown` at the boundary and narrowed to the format's SDK type
   * below — the converters parse the full payload defensively.
   */
  params: unknown
  inputFormat?: InputFormat
  outputFormat?: OutputFormat
  /** Request abort signal (`context.request.signal`); aborts the upstream stream on client disconnect. */
  signal?: AbortSignal
  onError?: (error: unknown) => void
  onComplete?: () => void
}

/**
 * Process a gateway message request — auto-detects streaming from `params.stream`.
 * Returns a Web `Response` (SSE stream or JSON) to be returned from the route.
 */
export async function processMessage(config: MessageConfig): Promise<Response> {
  const { inputFormat = 'anthropic', outputFormat = 'anthropic', onError, onComplete, signal } = config
  // Trust boundary: narrow the loosely-validated body to the format's SDK type once.
  const params = config.params as InputParams

  // 1. Resolve model: the request `model` is "providerId:modelId" (split on FIRST ':').
  const modelString = 'model' in params ? (params as { model?: string }).model : undefined
  if (!modelString || typeof modelString !== 'string') {
    throw new Error('Request is missing a "model" field')
  }
  const sepIdx = modelString.indexOf(':')
  if (sepIdx <= 0 || sepIdx >= modelString.length - 1) {
    throw new Error(`Invalid model format: "${modelString}". Expected "providerId:modelId".`)
  }
  const providerId = modelString.slice(0, sepIdx)
  const modelId = modelString.slice(sepIdx + 1)
  const uniqueModelId = createUniqueModelId(providerId, modelId)

  const isStreaming = 'stream' in params && (params as { stream?: boolean }).stream === true

  logger.info(`Starting ${isStreaming ? 'streaming' : 'non-streaming'} message`, {
    providerId,
    modelId,
    inputFormat,
    outputFormat
  })

  // 2. Build converter and extract messages / tools / sampling / provider options.
  const converter = MessageConverterFactory.create(inputFormat, {
    googleReasoningCache,
    openRouterReasoningCache
  })

  const messages = converter.toUIMessages(params)
  const tools = converter.toAiSdkTools?.(params)
  const streamOptions = converter.extractStreamOptions(params)

  // Provider options (reasoning/thinking) need a Provider; load it from the data
  // layer. Best-effort — if unavailable, proceed without provider options.
  let provider: Provider | undefined = config.provider
  if (!provider) {
    provider = await providerService.getByProviderId(providerId).catch(() => undefined)
  }
  const providerOptions = provider ? converter.extractProviderOptions(provider, params) : undefined

  // 3. Assemble first-class per-request overrides (sampling / tools / provider options).
  const callOverrides: CallOverrides = {
    ...streamOptions,
    ...(tools ? { tools } : {}),
    ...(providerOptions ? { providerOptions } : {})
  }

  // 4. Adapter + formatter translate UIMessageChunk → output format.
  const adapter: IStreamAdapter = StreamAdapterFactory.createAdapter(outputFormat, {
    model: `${providerId}:${modelId}`
  })
  const formatter: ISseFormatter = StreamAdapterFactory.getFormatter(outputFormat)

  const streamId = `gateway-${uuidv4()}`
  const aiStreamManager = application.get('AiStreamManager')

  if (isStreaming) {
    // Streaming: stream the adapter's formatted SSE frames out of a ReadableStream.
    const encoder = new TextEncoder()
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const safeClose = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            // already closed
          }
        }

        const onAbort = () => {
          aiStreamManager.abort(streamId, 'gateway client disconnected')
          safeClose()
        }
        if (signal) {
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }

        const listener: StreamListener = new SseListener(
          (data) => {
            if (closed) return
            controller.enqueue(encoder.encode(data))
          },
          () => {
            safeClose()
            logger.info('Message completed', { providerId, modelId, streaming: true })
            onComplete?.()
          },
          () => !closed,
          {
            id: `gateway:${streamId}`,
            // Stateful: each UIMessageChunk → 0..N formatted SSE frames (named event:/data:).
            formatChunk: (chunk) => adapter.transformChunk(chunk).map((event) => formatter.formatEvent(event)),
            // Terminal: flush the adapter's closing events (e.g. message_stop) + the format's done marker.
            formatDone: () =>
              adapter
                .finalizeEvents()
                .map((event) => formatter.formatEvent(event))
                .join('') + formatter.formatDone(),
            // Pause = idle-timeout / mid-stream abort (never a clean finish). Emit a
            // dialect error frame so the client can tell a truncation from completion.
            // (Skipped when the client itself disconnected — `closed` is already set.)
            formatPaused: () => {
              logger.warn('Gateway stream paused before completion; emitting truncation error frame', {
                providerId,
                modelId,
                streamId
              })
              return buildStreamErrorFrame(outputFormat, streamInterruptedError())
            },
            // Project the error into the per-dialect, isDev-gated envelope — never the
            // raw SerializedError (which would leak stack / url / request+response bodies).
            formatError: (error) => {
              onError?.(error)
              return buildStreamErrorFrame(outputFormat, error)
            }
          }
        )

        aiStreamManager.streamPrompt({
          streamId,
          uniqueModelId,
          messages,
          listener,
          callOverrides,
          idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS
        })
      },
      cancel() {
        closed = true
        aiStreamManager.abort(streamId, 'gateway client disconnected')
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
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
      adapter.transformChunk(chunk)
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
        providerId,
        modelId,
        streamId
      })
      rejectDone(streamInterruptedError())
    },
    onError: (result) => rejectDone(result.error),
    isAlive: () => !aborted
  }

  try {
    aiStreamManager.streamPrompt({
      streamId,
      uniqueModelId,
      messages,
      listener,
      callOverrides,
      idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS
    })

    await done

    // Flush the adapter's finalize step, then emit the accumulated response.
    adapter.finalizeEvents()

    logger.info('Message completed', { providerId, modelId, streaming: false })
    onComplete?.()

    return new Response(JSON.stringify(adapter.buildNonStreamingResponse()), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    logger.error('Error in message processing', error as Error, { providerId, modelId })
    onError?.(error)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
