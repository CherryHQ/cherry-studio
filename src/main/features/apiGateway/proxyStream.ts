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

import { application } from '@application'
import { loggerService } from '@logger'
import { SseListener, type StreamListener } from '@main/ai/streamManager'
import type { CallOverrides } from '@main/ai/types'
import type { Provider } from '@shared/data/types/provider'
import type { UIMessageChunk } from 'ai'
import { v4 as uuidv4 } from 'uuid'

import type { InputFormat, InputParamsMap, ISseFormatter, IStreamAdapter, OutputFormat } from './adapters'
import { MessageConverterFactory, StreamAdapterFactory } from './adapters'
import { buildStreamErrorFrame } from './errors'
import { googleReasoningCache, openRouterReasoningCache } from './reasoningCache'
import { resolveGatewayModelAddress } from './utils/models'

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
  /**
   * Explicit `"providerId:modelId"` addressing. The OpenAI/Anthropic dialects
   * carry the model in the body (`params.model`); Gemini carries it in the URL
   * path, so its route passes it here to override the body lookup.
   */
  modelString?: string
  /**
   * Explicit streaming flag. The OpenAI/Anthropic dialects signal streaming via
   * `params.stream`; Gemini signals it via the `:streamGenerateContent` method,
   * so its route passes the resolved flag here.
   */
  streaming?: boolean
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

  // Client-addressing mistakes are 400s, not 500s. Notably gemini-cli's internal
  // utility calls (chat compression, classification) hardcode bare `gemini-*-flash-lite`
  // model names that can never carry the gateway's providerId prefix — those requests
  // fail here by design (gemini-cli swallows them silently) and must not read as
  // gateway server errors in the logs.
  const asClientError = (error: unknown): Error & { status: number } => {
    const err = (error instanceof Error ? error : new Error(String(error))) as Error & { status: number }
    err.status = 400
    return err
  }

  // 1. Resolve the external "providerId:apiModelId" address from Gemini's URL-path
  // override or the request body, then map it to the internal model id.
  const modelString = config.modelString ?? ('model' in params ? (params as { model?: string }).model : undefined)
  if (!modelString || typeof modelString !== 'string') {
    throw asClientError(new Error('Request is missing a "model" field'))
  }
  let resolvedAddress: ReturnType<typeof resolveGatewayModelAddress>
  try {
    resolvedAddress = resolveGatewayModelAddress(modelString)
  } catch (error) {
    throw asClientError(error)
  }
  const { providerId, apiModelId: modelId, uniqueModelId, provider: resolvedProvider } = resolvedAddress

  const isStreaming = config.streaming ?? ('stream' in params && (params as { stream?: boolean }).stream === true)

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

  // Provider options (reasoning/thinking) use the same enabled provider resolved above.
  const provider: Provider = config.provider ?? resolvedProvider
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
          logger.info('Message completed', { providerId, modelId, streaming: true })
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
              providerId,
              modelId,
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
          onChunk: (chunk) => sseListener.onChunk(chunk),
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
            streamId,
            uniqueModelId,
            messages,
            listener,
            callOverrides,
            idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS
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
