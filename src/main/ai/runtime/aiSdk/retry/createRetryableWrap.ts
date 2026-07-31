/**
 * Builds the `wrapModel` closure that wraps a resolved chat model with
 * ai-retry: same-model transient retry on retryable API errors (429/503/529
 * and other `isRetryable` `APICallError`s, with backoff) first, then
 * cross-model fallback to the user-configured retry models.
 *
 * Fallbacks are built by the caller (`buildFallbackModels`) through
 * the same `buildAgentParams` pipeline as the primary, so each fallback model
 * already carries its own feature middleware and its own call-option overrides
 * (sampling / providerOptions / headers). This leaf only assembles the
 * ai-retry policy — it does not load providers/models itself.
 *
 * Strategy is a fixed internal policy (not user-configurable): same-model retry
 * on retryable errors, then cross-model fallback. The retry conditions use
 * ai-retry's condition-based API (`error.isRetryable(true).retry(...)`). The
 * `error.isRetryable(true)` condition matches retryable API errors only; it does
 * not handle `AbortSignal.timeout()` style `TimeoutError`s — Cherry's abort
 * signal is the user's cancel/request scope, so timeouts are deliberately not
 * retried here.
 *
 * Streaming caveat: ai-retry can only retry/fall back before the first
 * content chunk is emitted; mid-stream errors surface as stream errors.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import {
  isErrorAttempt,
  type LanguageModel,
  type LanguageModelRetryCallOptions,
  type Retries,
  type Retryable,
  type RetryContext
} from 'ai-retry'
import { createRetryableModel, error } from 'ai-retry/language-model'

import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'

import type { RetryPolicy } from './retryPolicy'

const logger = loggerService.withContext('ModelRetry')

export type WrapLanguageModel = (model: LanguageModelV3) => LanguageModelV3

/**
 * Per-fallback call-option overrides ai-retry merges into the request when it
 * switches to that fallback (sampling / `providerOptions` / `headers`).
 */
export type FallbackCallOptions = LanguageModelRetryCallOptions

/** A resolved fallback: a fully-resolved (middleware-applied) model + its own params. */
export interface RetryFallback {
  model: LanguageModelV3
  options?: FallbackCallOptions
}

/**
 * Lazily resolves a fallback on first failure. Building one is expensive
 * (per-fallback `buildAgentParams` — which can sync MCP tools — plus model
 * resolution), so the happy path must pay nothing. Resolves to `null` when the
 * fallback is gated out or unresolvable.
 */
export type FallbackResolver = () => Promise<RetryFallback | null>

export interface CreateRetryableWrapOptions {
  /**
   * Fallback resolvers in user-configured order. Each is invoked once (memoized)
   * after it successfully resolves. A `null` result is retried on the next
   * failure so a transient resolution problem does not disable that fallback.
   */
  fallbacks: FallbackResolver[]
  retryPolicy: RetryPolicy
  /** Stable request identifiers attached to retry diagnostics. */
  diagnosticContext?: Readonly<Record<string, unknown>>
  /** Invoked when retry starts or settles (e.g. to reconcile a live UI status part). */
  onRetryEvent?: (event: RetryPartData) => void
}

const RETRY_BASE_DELAY_MS = 1_000

function describeAttempt(context: RetryContext<LanguageModelV3>): Extract<RetryPartData, { state: 'retrying' }> {
  const { current, attempts } = context
  let reason = 'unknown'
  if (isErrorAttempt(current)) {
    const { error } = current
    if (APICallError.isInstance(error)) {
      reason =
        error.statusCode !== undefined
          ? `http ${error.statusCode}: ${error.message}`
          : `${error.name}: ${error.message}`
    } else if (error instanceof Error) {
      reason = `${error.name}: ${error.message}`
    }
  } else {
    reason = 'result rejected'
  }
  return { state: 'retrying', modelId: current.model.modelId, attempt: attempts.length + 1, reason }
}

/**
 * Returns a `wrapModel` closure when retry is enabled, otherwise `undefined`.
 */
export function createRetryableWrap(options: CreateRetryableWrapOptions): WrapLanguageModel | undefined {
  if (!options.retryPolicy.enabled) return undefined

  // `max_attempts` is the number of RETRIES (matches the "Max retry attempts"
  // setting and the embedding/rerank AI SDK `maxRetries`). ai-retry counts the
  // original call in `maxAttempts`, so +1 yields that many same-model retries.
  const retryCount = options.retryPolicy.maxAttempts
  const backoffEnabled = options.retryPolicy.backoffEnabled

  const retries: Retries<LanguageModel> = [
    // Same-model transient retry on retryable errors: honors Retry-After headers,
    // otherwise delay + backoff. (`.retry()` requires maxAttempts >= 2, which
    // holds since retryCount >= 1.)
    error.isRetryable(true).retry({
      maxAttempts: retryCount + 1,
      delay: RETRY_BASE_DELAY_MS,
      ...(backoffEnabled && { backoffFactor: 2 })
    }),
    // Cross-model fallback, tried in user-configured order (one attempt each).
    // Resolved lazily on first failure (memoized) so the happy path pays nothing;
    // each fallback carries its own middleware + params (a per-retry override).
    // Error-only (like a plain-model fallback): ai-retry also evaluates function
    // retryables on *result* attempts (content-filter etc.), so guard on
    // `isErrorAttempt` to avoid resolving — and falsely retrying — on success.
    ...options.fallbacks.map((resolveFallback): Retryable<LanguageModel> => {
      let cached: Promise<RetryFallback | null> | undefined
      return async (context) => {
        if (!isErrorAttempt(context.current)) return undefined
        cached ??= resolveFallback()
        const fallback = await cached
        if (!fallback) {
          cached = undefined
          return undefined
        }
        return fallback.options ? { model: fallback.model, options: fallback.options } : { model: fallback.model }
      }
    })
  ]

  return (base) => {
    let retryActive = false
    const settleRetryStatus = () => {
      if (!retryActive) return
      retryActive = false
      options.onRetryEvent?.({ state: 'settled' })
    }

    return createRetryableModel({
      model: base,
      retries,
      onRetry: (context) => {
        const event = describeAttempt(context)
        const failedModelId = context.attempts.at(-1)?.model.modelId
        if (failedModelId && failedModelId !== event.modelId) {
          logger.warn('falling back to a different model', {
            ...options.diagnosticContext,
            failedModelId,
            fallbackModelId: event.modelId,
            attempt: event.attempt,
            reason: event.reason
          })
        } else {
          logger.info('retrying model call', { ...options.diagnosticContext, ...event })
        }
        retryActive = true
        options.onRetryEvent?.(event)
      },
      onSuccess: settleRetryStatus,
      onFailure: (context) => {
        const failure = context.error instanceof Error ? context.error : new Error(String(context.error))
        logger.error('model call failed after retries', failure, {
          ...options.diagnosticContext,
          attempts: context.attempts.length,
          lastModelId: context.current.model.modelId,
          attemptErrors: context.attempts.flatMap((attempt) =>
            isErrorAttempt(attempt)
              ? [
                  {
                    modelId: attempt.model.modelId,
                    reason:
                      attempt.error instanceof Error ? `${attempt.error.name}: ${attempt.error.message}` : 'unknown'
                  }
                ]
              : []
          )
        })
        settleRetryStatus()
      }
    })
  }
}
