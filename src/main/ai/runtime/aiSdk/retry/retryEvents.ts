import type { LanguageModelV3, LanguageModelV3StreamResult } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { isErrorAttempt, type RetryContext } from 'ai-retry'

import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'

import { getTerminalModelError } from '../../../utils/retryError'

const logger = loggerService.withContext('ModelRetry')

export function createModelRetryEvents(
  publish: ((event: RetryPartData) => void) | undefined,
  diagnosticContext: Readonly<Record<string, unknown>> | undefined,
  signal: AbortSignal | undefined
) {
  let active = false
  let settled = false

  function settle() {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', settle)
    if (active) publish?.({ state: 'settled' })
  }

  return {
    reportError({ current, attempts }: RetryContext<LanguageModelV3>) {
      if (!isErrorAttempt(current)) return
      const error = getTerminalModelError(current.error)
      logger.debug('model retry attempt failed', {
        ...diagnosticContext,
        modelId: current.model.modelId,
        attempt: attempts.length,
        statusCode: APICallError.isInstance(error) ? error.statusCode : undefined
      })
    },
    report(context: RetryContext<LanguageModelV3>, credentialModelId?: string) {
      if (settled || signal?.aborted) return
      const { current, attempts } = context
      const error = isErrorAttempt(current) ? current.error : undefined
      let reason = isErrorAttempt(current) ? 'unknown' : 'result rejected'
      if (APICallError.isInstance(error) && error.statusCode !== undefined) {
        reason = `http ${error.statusCode}: ${error.message}`
      } else if (error instanceof Error) {
        reason = `${error.name}: ${error.message}`
      }
      const event = {
        state: 'retrying',
        modelId: credentialModelId ?? current.model.modelId,
        attempt: attempts.length + 1,
        reason
      } as const
      const failed = attempts.at(-1)?.model
      if (credentialModelId !== undefined) {
        logger.info('retrying model call with next API key', { ...diagnosticContext, ...event })
      } else if (failed && (failed.provider !== current.model.provider || failed.modelId !== current.model.modelId)) {
        logger.warn('falling back to a different model', {
          ...diagnosticContext,
          failedModelId: failed.modelId,
          fallbackModelId: event.modelId,
          attempt: event.attempt,
          reason
        })
      } else {
        logger.info('retrying model call', { ...diagnosticContext, ...event })
      }
      if (!active && publish) signal?.addEventListener('abort', settle, { once: true })
      active = true
      publish?.(event)
    },
    settle,
    observeStream(result: LanguageModelV3StreamResult): LanguageModelV3StreamResult {
      if (!publish) return result
      const reader = result.stream.getReader()
      return {
        ...result,
        stream: new ReadableStream(
          {
            async pull(controller) {
              try {
                const part = await reader.read()
                if (!part.done) {
                  controller.enqueue(part.value)
                  return
                }
                reader.releaseLock()
                settle()
                controller.close()
              } catch (error) {
                reader.releaseLock()
                settle()
                controller.error(error)
              }
            },
            async cancel(reason) {
              settle()
              try {
                await reader.cancel(reason)
              } finally {
                reader.releaseLock()
              }
            }
          },
          { highWaterMark: 0 }
        )
      }
    }
  }
}
