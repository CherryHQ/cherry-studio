/**
 * Mid-stream auto-retry. ai-retry only retries before the first content chunk,
 * so a connection that drops after some text has streamed would otherwise
 * surface as an error. When the interrupted partial output is plain text, this
 * re-issues the request with that text as an assistant prefill and splices the
 * continuation into the same text part. Interruptions that carry reasoning,
 * tool calls, files or sources are not resumable and surface unchanged.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult
} from '@ai-sdk/provider'
import { APICallError, AISDKError, RetryError } from 'ai'

import { isAbortError } from '@main/utils/error'

export interface StreamContinuationOptions {
  /** Maximum number of continuation attempts per call. */
  maxAttempts: number
  /** Shares remaining same-model retries with the pre-content retry layer. */
  takeRetry?: () => boolean
  baseDelayMs: number
  backoffEnabled: boolean
  /** Called before each continuation attempt (1-based) with a short reason. */
  onRetry?: (info: { attempt: number; reason: string }) => void
  /** Called once a continuation attempt produced output or the stream settled. */
  onSettled?: () => void
  /**
   * Called when a buffered (invisible) resumed attempt receives a part. Buffered output never
   * reaches the consumer, so a consumer-side idle timer would otherwise see a silent stream.
   */
  onBufferedActivity?: () => void
}

function isResumableError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || isAbortError(error)) return false
  // ai-retry aggregates failures once more than one attempt has run. The
  // last failure still decides whether an interrupted accepted body can resume.
  if (RetryError.isInstance(error)) return isResumableError(error.lastError, signal)
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true
    // An accepted response can fail while its body is read; a permanent HTTP rejection cannot.
    const successfulResponse = error.statusCode !== undefined && error.statusCode >= 200 && error.statusCode < 300
    return (
      successfulResponse &&
      error.cause instanceof Error &&
      /terminated|socket|network|incomplete.*chunk|connection.*(?:reset|closed)/i.test(error.cause.message)
    )
  }
  return !AISDKError.isInstance(error)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export function withStreamContinuation(model: LanguageModelV3, options: StreamContinuationOptions): LanguageModelV3 {
  const doStream = async (callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    const first = await model.doStream(callOptions)
    const signal = callOptions.abortSignal

    let reader = first.stream.getReader()
    let text = ''
    let openTextId: string | undefined
    // Structured-output calls parse the whole body as one JSON document: a
    // prefilled resume cannot produce valid JSON (the provider may restart the
    // document), so partial output must surface instead of re-issuing.
    let resumable = callOptions.responseFormat?.type !== 'json'
    let attempts = 0
    let resuming = false
    let cancelled = false
    // Resumed text-part id -> the original part id the UI already has open.
    const idMap = new Map<string, string>()
    let adoptNextTextStart = false
    // A resumed attempt buffers its parts until it completes: a failed attempt's
    // output is dropped instead of spliced in, so a provider that ignores the
    // prefill and restarts cannot leave repeated partial text behind.
    let buffer: LanguageModelV3StreamPart[] | null = null
    let snapshot: { text: string; openTextId: string | undefined; resumable: boolean } | null = null

    const dropAttempt = () => {
      if (!buffer) return
      buffer = null
      if (snapshot) {
        text = snapshot.text
        openTextId = snapshot.openTextId
        // A dropped attempt's non-text output never reached the consumer, but the provider may
        // already have run the tool: the exclusion survives rollback so it cannot run twice.
        resumable = snapshot.resumable && resumable
        snapshot = null
      }
    }

    const settle = () => {
      if (!resuming) return
      resuming = false
      options.onSettled?.()
    }

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async pull(controller) {
        while (true) {
          let part: LanguageModelV3StreamPart | undefined
          let failure: { error: unknown } | undefined
          try {
            const next = await reader.read()
            if (next.done) {
              if (buffer) {
                for (const buffered of buffer) controller.enqueue(buffered)
                buffer = null
                snapshot = null
              }
              settle()
              controller.close()
              return
            }
            part = next.value
            if (part.type === 'error') failure = { error: part.error }
            else if (buffer && part.type === 'finish' && part.finishReason.unified === 'error') {
              // A replacement can end with finish reason `error` and no error chunk (OpenAI Responses
              // `response.failed` without details). Flushing it would save a truncated reply as a success
              // and hide the original disconnect, so treat it as a failed attempt and surface an error.
              // A provider-declared reason (Gemini `MALFORMED_FUNCTION_CALL`, with its `finishMessage`) is
              // deterministic, so keep it in the surfaced error and do not spend another retry on it.
              const raw = part.finishReason.raw
              const finishMessage = (part.providerMetadata?.google as { finishMessage?: unknown } | undefined)
                ?.finishMessage
              const detail = [raw, typeof finishMessage === 'string' ? finishMessage : undefined]
                .filter(Boolean)
                .join(': ')
              failure = {
                error: detail
                  ? new AISDKError({
                      name: 'ResumedStreamFinishError',
                      message: `Resumed stream finished with an error: ${detail}`
                    })
                  : new Error('Resumed stream finished with an error and no error detail')
              }
              part = undefined
            }
          } catch (error) {
            failure = { error }
          }

          if (failure) {
            dropAttempt()
            const canResume =
              resumable &&
              text.length > 0 &&
              attempts < options.maxAttempts &&
              !cancelled &&
              isResumableError(failure.error, signal) &&
              (options.takeRetry?.() ?? true)
            if (!canResume) {
              settle()
              if (part) controller.enqueue(part)
              else controller.error(failure.error)
              return
            }
            attempts += 1
            resuming = true
            snapshot = { text, openTextId, resumable }
            buffer = []
            options.onRetry?.({
              attempt: attempts,
              reason: failure.error instanceof Error ? failure.error.message : String(failure.error)
            })
            await reader.cancel().catch(() => {})
            await sleep(options.baseDelayMs * (options.backoffEnabled ? 2 ** (attempts - 1) : 1), signal)
            if (cancelled) {
              settle()
              return
            }
            try {
              signal?.throwIfAborted()
              const resumed = await model.doStream({
                ...callOptions,
                prompt: [...callOptions.prompt, { role: 'assistant', content: [{ type: 'text', text }] }]
              })
              const replacement = resumed.stream.getReader()
              if (cancelled) {
                await replacement.cancel().catch(() => {})
                settle()
                return
              }
              reader = replacement
            } catch (error) {
              settle()
              if (cancelled) return
              controller.error(error)
              return
            }
            resuming = true
            idMap.clear()
            adoptNextTextStart = openTextId !== undefined
            continue
          }

          let chunk = part!
          if (resuming && (chunk.type === 'stream-start' || chunk.type === 'response-metadata')) continue
          if (chunk.type === 'text-start') {
            if (resuming && adoptNextTextStart && openTextId !== undefined) {
              adoptNextTextStart = false
              idMap.set(chunk.id, openTextId)
              continue
            }
            openTextId = chunk.id
          } else if (chunk.type === 'text-delta' || chunk.type === 'text-end') {
            const mapped = idMap.get(chunk.id)
            if (mapped !== undefined) chunk = { ...chunk, id: mapped }
            if (chunk.type === 'text-delta') text += chunk.delta
            else if (chunk.id === openTextId) openTextId = undefined
          } else if (
            chunk.type !== 'raw' &&
            chunk.type !== 'finish' &&
            chunk.type !== 'stream-start' &&
            chunk.type !== 'response-metadata'
          ) {
            resumable = false
          }
          if (buffer) {
            // Buffered parts stay invisible until the attempt completes: keep this
            // pull looping instead of resolving it without enqueueing (that stalls
            // the stream - pull is only re-driven when a read request is pending).
            buffer.push(chunk)
            options.onBufferedActivity?.()
            continue
          }
          if (chunk.type !== 'raw') settle()
          controller.enqueue(chunk)
          return
        }
      },
      async cancel(reason) {
        cancelled = true
        settle()
        await reader.cancel(reason).catch(() => {})
      }
    })

    return { ...first, stream }
  }

  return new Proxy(model, {
    get(target, prop) {
      if (prop === 'doStream') return doStream
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
