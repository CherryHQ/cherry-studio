import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { SseListener, type StreamListener } from '@main/ai/streamManager'
import type { SerializedError } from '@shared/types/error'

import type { ISseFormatter, IStreamAdapter } from './adapters'
import { StreamAdapterFactory } from './adapters'
import { buildStreamErrorFrame, internalGatewayError } from './errors'
import type { MessageConfig } from './gatewayRequest'
import { gatewayPromptOptions, prepareGatewayMessage } from './prepareGatewayMessage'
import { isStartupCommitChunk, streamInterruptedError } from './streamLifecycle'

export type { MessageConfig } from './gatewayRequest'

const logger = loggerService.withContext('ProxyStreamService')

type StartupState = 'pending' | 'committed' | 'abandoned' | 'failed'

export async function processMessage(config: MessageConfig): Promise<Response> {
  const request = await prepareGatewayMessage(config)
  const { messages, convertedMessages, adapterOptions, internal, outputFormat, logContext, isStreaming } = request
  const { onError, onComplete, signal } = config
  const adapter: IStreamAdapter = StreamAdapterFactory.createAdapter(outputFormat, adapterOptions)
  const formatter: ISseFormatter = StreamAdapterFactory.getFormatter(outputFormat)
  const usageContext = config.requestHeaders
    ? application
        .get('ApiGatewayService')
        .resolveAgentSessionUsage(config.requestHeaders, adapter.getMessageId(), request.modelString)
    : undefined

  const promptOptions = gatewayPromptOptions(request, usageContext)
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

        let callbackError: SerializedError | undefined
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
            onError?.(callbackError ?? error)
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
          onError: (result, originalError) => {
            logger.warn('Gateway stream failed', { ...logContext, streamId, error: result.error })
            const upstream = internal ? internalGatewayError(originalError, result.error) : result.error
            if (startupState !== 'pending') {
              callbackError = result.error
              return sseListener.onError({ ...result, error: upstream })
            }

            fail(upstream)
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
            ...promptOptions,
            streamId,
            listener
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
  let callbackError: SerializedError | undefined
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
    onError: (result, originalError) => {
      callbackError = result.error
      rejectDone(internal ? internalGatewayError(originalError, result.error) : result.error)
    },
    isAlive: () => !aborted && !adapterFailed
  }

  try {
    if (!aborted) {
      aiStreamManager.streamPrompt({
        ...promptOptions,
        streamId,
        listener
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
    onError?.(callbackError ?? error)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
