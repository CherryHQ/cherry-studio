import { randomUUID } from 'node:crypto'

import type { ObjectTransportResponse, ObjectTransports } from '@earendil-works/pi-ai'
import type { UIMessageChunk } from 'ai'

import { application } from '@application'
import { loggerService } from '@logger'
import type { StreamListener } from '@main/ai/streamManager'
import { serializeError } from '@main/ai/utils/serializeError'

import { type IStreamAdapter, StreamAdapterFactory, type StreamAdapterOptions } from './adapters'
import { objectGatewayError } from './errors'
import type { AgentGatewayContext, MessageConfig } from './gatewayRequest'
import { gatewayPromptOptions, prepareGatewayMessage } from './prepareGatewayMessage'
import { isStartupCommitChunk, streamInterruptedError } from './streamLifecycle'

const logger = loggerService.withContext('GatewayObjectStream')

type ObjectMessageConfig = MessageConfig & { timeoutMs?: number }

type ObjectItem<T> = { kind: 'event'; event: T } | { kind: 'error'; error: unknown }

export function createGatewayObjectTransports(config: {
  agentContext: AgentGatewayContext
  requestHeaders?: Headers
}): Required<ObjectTransports> {
  return {
    'anthropic-messages': async (params, options) => {
      const response = await processObjectMessage(
        { ...config, params, ...options, inputFormat: 'anthropic', outputFormat: 'anthropic' },
        (input) => StreamAdapterFactory.createAdapter('anthropic', input)
      )
      return {
        ...response,
        events: mapEvents(response.events, (event) =>
          event.type === 'message_delta'
            ? {
                ...event,
                delta: { ...event.delta, container: null },
                usage: { ...event.usage, output_tokens_details: event.usage.output_tokens_details ?? null }
              }
            : event.type === 'message_start'
              ? {
                  ...event,
                  message: {
                    ...event.message,
                    diagnostics: null,
                    container: null,
                    usage: { ...event.message.usage, output_tokens_details: null }
                  }
                }
              : event
        )
      }
    },
    'openai-completions': (params, options) =>
      processObjectMessage({ ...config, params, ...options, inputFormat: 'openai', outputFormat: 'openai' }, (input) =>
        StreamAdapterFactory.createAdapter('openai', input)
      ),
    'openai-responses': (params, options) =>
      processObjectMessage(
        { ...config, params, ...options, inputFormat: 'openai-responses', outputFormat: 'openai-responses' },
        (input) => StreamAdapterFactory.createAdapter('openai-responses', input)
      ),
    'google-generative-ai': async (params, options) => {
      const nativeConfig = params.config ?? {}
      const supported = new Set([
        'systemInstruction',
        'tools',
        'toolConfig',
        'temperature',
        'topP',
        'topK',
        'maxOutputTokens',
        'stopSequences',
        'thinkingConfig',
        'abortSignal',
        'httpOptions'
      ])
      const unsupported = Object.entries(nativeConfig).filter(
        ([key, value]) => value !== undefined && !supported.has(key)
      )
      if (unsupported.length > 0) {
        const error = Object.assign(
          new Error(`Unsupported Gemini config: ${unsupported.map(([key]) => key).join(', ')}`),
          { status: 400 }
        )
        logger.warn('Gateway object request failed', { agentSessionId: config.agentContext.agentSessionId, error })
        throw objectGatewayError(error, serializeError(error), 'gemini')
      }
      const { GenerateContentResponse } = await import('@google/genai')
      const {
        systemInstruction,
        tools,
        toolConfig,
        temperature,
        topP,
        topK,
        maxOutputTokens,
        stopSequences,
        thinkingConfig
      } = nativeConfig
      const response = await processObjectMessage(
        {
          ...config,
          ...options,
          inputFormat: 'gemini',
          outputFormat: 'gemini',
          modelString: params.model,
          params: {
            contents: params.contents,
            systemInstruction,
            tools,
            toolConfig,
            generationConfig: { temperature, topP, topK, maxOutputTokens, stopSequences, thinkingConfig }
          }
        },
        (input) => StreamAdapterFactory.createAdapter('gemini', input)
      )
      return {
        ...response,
        events: mapEvents(response.events, (event) => Object.assign(new GenerateContentResponse(), event))
      }
    }
  }
}

async function processObjectMessage<T>(
  config: ObjectMessageConfig,
  createAdapter: (options: StreamAdapterOptions) => IStreamAdapter<T>
): Promise<ObjectTransportResponse<T>> {
  const timeoutController = new AbortController()
  const signal = AbortSignal.any([timeoutController.signal, ...(config.signal ? [config.signal] : [])])
  const timeout =
    config.timeoutMs === undefined
      ? undefined
      : setTimeout(
          () =>
            timeoutController.abort(
              Object.assign(new DOMException('Model request timeout exceeded', 'TimeoutError'), { status: 504 })
            ),
          config.timeoutMs
        )
  try {
    return await openObjectMessage({ ...config, signal }, createAdapter)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function openObjectMessage<T>(
  config: ObjectMessageConfig,
  createAdapter: (options: StreamAdapterOptions) => IStreamAdapter<T>
): Promise<ObjectTransportResponse<T>> {
  config.signal?.throwIfAborted()
  const request = await prepareGatewayMessage({ ...config, streaming: true }).catch((error: unknown) => {
    if (config.signal?.aborted) throw error
    logger.warn('Gateway object request failed', { agentSessionId: config.agentContext?.agentSessionId, error })
    throw objectGatewayError(error, serializeError(error), config.outputFormat ?? 'anthropic')
  })
  config.signal?.throwIfAborted()
  const adapter = createAdapter(request.adapterOptions)
  const usageContext = config.agentContext?.resolveUsage(adapter.getMessageId())
  const manager = application.get('AiStreamManager')
  const streamId = `gateway-object-${randomUUID()}`
  let controller!: ReadableStreamDefaultController<ObjectItem<T>>
  let closed = false
  let started = false
  let wake: (() => void) | undefined
  let resolveStart!: () => void
  let rejectStart!: (error: unknown) => void
  const startup = new Promise<void>((resolve, reject) => {
    resolveStart = resolve
    rejectStart = reject
  })
  const release = () => {
    wake?.()
    wake = undefined
  }
  const commit = () => {
    if (!started) {
      started = true
      resolveStart()
    }
  }
  const close = () => {
    if (closed) return
    closed = true
    config.signal?.removeEventListener('abort', abort)
    controller.close()
    release()
  }
  const fail = (error: unknown) => {
    if (closed) return
    if (!config.signal?.aborted || config.signal.reason?.name === 'TimeoutError') {
      logger.warn('Gateway object stream failed', { ...request.logContext, streamId, error })
    }
    if (!started) rejectStart(error)
    else controller.enqueue({ kind: 'error', error })
    close()
  }
  const abort = () => {
    fail(config.signal?.reason ?? new DOMException('Model call aborted', 'AbortError'))
    manager.abort(streamId, 'object model call aborted')
  }
  const write = (events: T[]) => {
    for (const event of events) controller.enqueue({ kind: 'event', event })
  }
  const cancel = (closeStream: boolean) => {
    if (closed) return
    closed = true
    config.signal?.removeEventListener('abort', abort)
    if (closeStream) controller.close()
    release()
    manager.abort(streamId, 'object model consumer closed')
  }
  const stream = new ReadableStream<ObjectItem<T>>(
    {
      start(value) {
        controller = value
      },
      pull() {
        release()
      },
      cancel: () => cancel(false)
    },
    { highWaterMark: 32 }
  )
  const listener: StreamListener = {
    id: streamId,
    ready: () =>
      closed || (controller.desiredSize ?? 0) > 0
        ? undefined
        : new Promise<void>((resolve) => {
            wake = resolve
          }),
    onChunk: (chunk: UIMessageChunk) => {
      if (closed) return
      try {
        const events = adapter.transformChunk(chunk)
        write(events)
        if (isStartupCommitChunk(chunk) || (chunk.type === 'tool-input-error' && events.length > 0)) commit()
      } catch (error) {
        fail(error)
        manager.abort(streamId, 'object model adapter failed')
      }
    },
    onDone: () => {
      if (closed) return
      try {
        write(adapter.finalizeEvents())
        commit()
        close()
      } catch (error) {
        fail(error)
      }
    },
    onError: (result, error) => fail(objectGatewayError(error, result.error, request.outputFormat)),
    onPaused: () => fail(streamInterruptedError()),
    isAlive: () => !closed
  }
  config.signal?.addEventListener('abort', abort, { once: true })
  try {
    manager.streamPrompt({
      ...gatewayPromptOptions(request, usageContext, config.timeoutMs),
      streamId,
      listener
    })
  } catch (error) {
    fail(error)
  }
  try {
    await startup
  } catch (error) {
    await stream.cancel()
    throw error
  }
  return {
    status: 200,
    headers: new Headers(),
    cancel: () => cancel(true),
    events: mapEvents(stream, (item) => {
      if (item.kind === 'error') throw item.error
      return item.event
    })
  }
}

function mapEvents<T, U>(events: AsyncIterable<T>, map: (event: T) => U): AsyncIterable<U> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = events[Symbol.asyncIterator]()
      return {
        async next() {
          let result
          try {
            result = await iterator.next()
            if (!result.done) return { done: false, value: map(result.value) } as const
          } catch (error) {
            await iterator.return?.()
            throw error
          }
          return { done: true, value: undefined } as const
        },
        async return() {
          await iterator.return?.()
          return { done: true, value: undefined } as const
        }
      }
    }
  }
}
