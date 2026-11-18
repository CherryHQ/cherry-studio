import { randomUUID } from 'node:crypto'

import type { ObjectTransportResponse, ObjectTransports } from '@earendil-works/pi-ai'
import { GenerateContentResponse } from '@google/genai'
import type { UIMessageChunk } from 'ai'

import { application } from '@application'
import type { StreamListener } from '@main/ai/streamManager'

import { type IStreamAdapter, StreamAdapterFactory, type StreamAdapterOptions } from './adapters'
import { objectGatewayError } from './errors'
import type { MessageConfig } from './gatewayRequest'
import { prepareGatewayMessage } from './prepareGatewayMessage'
import { GATEWAY_STREAM_IDLE_TIMEOUT_MS, isStartupCommitChunk, streamInterruptedError } from './streamLifecycle'

type ObjectItem<T> = { kind: 'event'; event: T } | { kind: 'error'; error: unknown }

export function createGatewayObjectTransports(
  config: Pick<MessageConfig, 'requestHeaders'>
): Required<ObjectTransports> {
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
                usage: { ...event.usage, output_tokens_details: null }
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
      const { systemInstruction, tools, toolConfig, safetySettings, cachedContent, ...generationConfig } =
        params.config ?? {}
      delete generationConfig.abortSignal
      delete generationConfig.httpOptions
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
            safetySettings,
            cachedContent,
            generationConfig
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
  config: MessageConfig,
  createAdapter: (options: StreamAdapterOptions) => IStreamAdapter<T>
): Promise<ObjectTransportResponse<T>> {
  config.signal?.throwIfAborted()
  const request = await prepareGatewayMessage({ ...config, streaming: true })
  config.signal?.throwIfAborted()
  const adapter = createAdapter(request.adapterOptions)
  const usageContext = config.requestHeaders
    ? application.get('ApiGatewayService').resolveAgentSessionUsage(config.requestHeaders, adapter.getMessageId())
    : undefined
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
  const stream = new ReadableStream<ObjectItem<T>>(
    {
      start(value) {
        controller = value
      },
      pull() {
        release()
      },
      cancel() {
        if (closed) return
        closed = true
        config.signal?.removeEventListener('abort', abort)
        release()
        manager.abort(streamId, 'object model consumer closed')
      }
    },
    { highWaterMark: 32 }
  )
  const listener: StreamListener = {
    id: streamId,
    ready: () =>
      closed || (controller.desiredSize ?? 0) > 0
        ? Promise.resolve()
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
      ...request.turnOptions,
      streamId,
      uniqueModelId: request.uniqueModelId,
      resolvedModel: request.resolvedModel,
      messages: request.messages,
      listener,
      callOverrides: request.callOverrides,
      contextOwner: 'caller',
      ...(usageContext ? { usageContext } : {}),
      ...(request.agentSessionId ? { tokenUsageSource: 'agent' as const } : {}),
      idleTimeoutMs: GATEWAY_STREAM_IDLE_TIMEOUT_MS,
      maxRetries: 0
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
