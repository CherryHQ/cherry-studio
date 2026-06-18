/**
 * Builds the `wrapModel` closure that wraps a resolved chat model with
 * ai-retry: same-model transient retry on retryable API errors (429/503/529
 * and other `isRetryable` `APICallError`s, with backoff) first, then
 * cross-model fallback to the user-configured retry models.
 *
 * Fallbacks are built by the caller (`AiService.buildFallbackModels`) through
 * the same `buildAgentParams` pipeline as the primary, so each fallback model
 * already carries its own feature middleware and its own call-option overrides
 * (sampling / providerOptions / headers). This leaf only assembles the
 * ai-retry policy — it does not load providers/models itself.
 *
 * Note: `retryAfterDelay` covers retryable API errors only — it does not
 * handle `AbortSignal.timeout()` style `TimeoutError`s (that would need a
 * separate `requestTimeout` retryable). Cherry's abort signal is the user's
 * cancel/request scope, so timeouts are deliberately not retried here.
 *
 * Streaming caveat: ai-retry can only retry/fall back before the first
 * content chunk is emitted; mid-stream errors surface as stream errors.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { application } from '@application'
import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'
import { APICallError } from 'ai'
import {
  createRetryable,
  isErrorAttempt,
  type LanguageModel,
  type LanguageModelRetryCallOptions,
  type Retries,
  type RetryContext
} from 'ai-retry'
import { retryAfterDelay } from 'ai-retry/retryables'

const logger = loggerService.withContext('ModelRetry')

/** Wire shape for the renderer-facing `data-retry` part. */
export type RetryEventPayload = RetryPartData

export type WrapLanguageModel = (model: LanguageModelV3) => LanguageModelV3

/**
 * Per-fallback call-option overrides ai-retry merges into the request when it
 * switches to that fallback (sampling / `providerOptions` / `headers`).
 */
export type FallbackCallOptions = LanguageModelRetryCallOptions

/** A pre-built fallback: a fully-resolved (middleware-applied) model + its own params. */
export interface RetryFallback {
  model: LanguageModelV3
  options?: FallbackCallOptions
}

export interface CreateRetryableWrapOptions {
  /**
   * Fallback models in user-configured order, each already resolved with its
   * own middleware and call-option overrides (see `AiService.buildFallbackModels`).
   */
  fallbacks: RetryFallback[]
  /** Invoked on each retry/fallback attempt (e.g. to surface a transient UI chunk). */
  onRetryEvent?: (event: RetryEventPayload) => void
}

const RETRY_BASE_DELAY_MS = 1_000

function describeAttempt(context: RetryContext<LanguageModelV3>): RetryEventPayload {
  const { current, attempts } = context
  let reason = 'unknown'
  if (isErrorAttempt(current)) {
    const { error } = current
    if (APICallError.isInstance(error)) {
      reason = error.statusCode !== undefined ? `http ${error.statusCode}` : (error.name ?? 'APICallError')
    } else if (error instanceof Error) {
      reason = error.name || error.message
    }
  } else {
    reason = 'result rejected'
  }
  return { modelId: current.model.modelId, attempt: attempts.length, reason }
}

/**
 * Returns a `wrapModel` closure when retry is enabled, otherwise `undefined`.
 */
export function createRetryableWrap(options: CreateRetryableWrapOptions): WrapLanguageModel | undefined {
  const preferences = application.get('PreferenceService')
  if (!preferences.get('chat.retry.enabled')) return undefined

  const maxAttempts = Math.max(1, preferences.get('chat.retry.max_attempts'))
  const backoffEnabled = preferences.get('chat.retry.backoff_enabled')

  const retries: Retries<LanguageModel> = [
    // Same-model transient retry: honors Retry-After headers, otherwise delay + backoff.
    retryAfterDelay<LanguageModel>({
      maxAttempts,
      delay: RETRY_BASE_DELAY_MS,
      ...(backoffEnabled && { backoffFactor: 2 })
    }),
    // Cross-model fallback, tried in user-configured order (one attempt each).
    // Each entry carries the fallback's own params as a per-retry option override.
    ...options.fallbacks.map((fallback) =>
      fallback.options ? { model: fallback.model, options: fallback.options } : fallback.model
    )
  ]

  return (base) =>
    createRetryable({
      model: base,
      retries,
      onRetry: (context) => {
        const event = describeAttempt(context)
        logger.info('retrying model call', { ...event })
        options.onRetryEvent?.(event)
      },
      onFailure: (context) => {
        logger.error('model call failed after retries', {
          attempts: context.attempts.length,
          lastModelId: context.current.model.modelId
        })
      }
    })
}
