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
    let resumable = true
    let attempts = 0
    let resuming = false
    let cancelled = false
    // Resumed text-part id -> the original part id the UI already has open.
    const idMap = new Map<string, string>()
    let adoptNextTextStart = false

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
              settle()
              controller.close()
              return
            }
            part = next.value
            if (part.type === 'error') failure = { error: part.error }
          } catch (error) {
            failure = { error }
          }

          if (failure) {
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
