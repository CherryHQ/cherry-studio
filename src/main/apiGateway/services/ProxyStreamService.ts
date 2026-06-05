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
 */

import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { SseListener } from '@main/ai/streamManager'
import type { StreamListener } from '@main/ai/streamManager/types'
import type { CallOverrides } from '@main/ai/types/requests'
import { application } from '@main/core/application'
import { createUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

import type { InputFormat, InputParamsMap, ISSEFormatter, IStreamAdapter, OutputFormat } from '../adapters'
import { MessageConverterFactory, StreamAdapterFactory } from '../adapters'
import { googleReasoningCache, openRouterReasoningCache } from './reasoning-cache'

const logger = loggerService.withContext('ProxyStreamService')

/** Union of all supported input params. */
type InputParams = InputParamsMap[InputFormat]

/**
 * Configuration for a gateway message request (streaming or non-streaming).
 * Routes pass `{ response, params, inputFormat, outputFormat }`.
 */
export interface MessageConfig {
  response: Response
  provider?: Provider
  modelId?: string
  params: InputParams
  inputFormat?: InputFormat
  outputFormat?: OutputFormat
  onError?: (error: unknown) => void
  onComplete?: () => void
}

/**
 * Process a gateway message request — auto-detects streaming from `params.stream`.
 */
export async function processMessage(config: MessageConfig): Promise<void> {
  const { response, inputFormat = 'anthropic', outputFormat = 'anthropic', onError, onComplete, params } = config

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
  const formatter: ISSEFormatter = StreamAdapterFactory.getFormatter(outputFormat)

  const streamId = `gateway-${uuidv4()}`
  const aiStreamManager = application.get('AiStreamManager')

  // Terminal barrier: resolved on done/paused, rejected on error.
  let resolveDone!: () => void
  let rejectDone!: (error: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  // Abort the stream if the client disconnects.
  const handleDisconnect = () => {
    aiStreamManager.abort(streamId, 'gateway client disconnected')
  }
  response.on('close', handleDisconnect)

  const listener: StreamListener = isStreaming
    ? new SseListener(
        (data) => {
          if (!response.writableEnded) response.write(data)
        },
        () => {
          if (!response.writableEnded) response.end()
          resolveDone()
        },
        () => !response.writableEnded,
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
          formatError: (error) => `data: ${JSON.stringify({ type: 'error', error })}\n\n`
        }
      )
    : {
        // Non-streaming: drive the adapter to accumulate state; respond with JSON at the end.
        id: `gateway:${streamId}`,
        onChunk: (chunk) => {
          adapter.transformChunk(chunk)
        },
        onDone: () => resolveDone(),
        onPaused: () => resolveDone(),
        onError: (result) => rejectDone(result.error),
        isAlive: () => !response.writableEnded
      }

  if (isStreaming) {
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
  }

  try {
    aiStreamManager.streamPrompt({
      streamId,
      uniqueModelId,
      messages,
      listener,
      callOverrides
    })

    await done

    if (!isStreaming) {
      // Flush the adapter's finalize step, then emit the accumulated response.
      adapter.finalizeEvents()
      if (!response.writableEnded) {
        response.json(adapter.buildNonStreamingResponse())
      }
    }

    logger.info('Message completed', { providerId, modelId, streaming: isStreaming })
    onComplete?.()
  } catch (error) {
    logger.error('Error in message processing', error as Error, { providerId, modelId })
    onError?.(error)
    throw error
  } finally {
    response.off('close', handleDisconnect)
  }
}

export default {
  processMessage
}
