/**
 * Builds the `wrapModel` closure that wraps a resolved chat model with
 * ai-retry. An optional Internal Agent recovery first rewrites explicitly
 * rejected image input to OCR text; the user-configurable policy then handles
 * same-model transient retries (429/503/529 and other retryable API errors)
 * followed by cross-model fallback.
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
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'
import { APICallError } from 'ai'
import {
  getModelKey,
  isErrorAttempt,
  type LanguageModel,
  type LanguageModelRetryCallOptions,
  type Retries,
  type Retryable,
  type RetryContext
} from 'ai-retry'
import { createRetryableModel, error } from 'ai-retry/language-model'

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
  /**
   * Internal Agent recovery: lazily replace rejected image inputs with OCR
   * text. Ordinary chat/provider calls leave this unset.
   */
  imageInputFallback?: (prompt: LanguageModelV3Prompt, signal?: AbortSignal) => Promise<LanguageModelV3Prompt | null>
}

const RETRY_BASE_DELAY_MS = 1_000
const IMAGE_REJECTION_PATTERNS = [
  /\bimage_url\b/i,
  /\b(?:images?|vision|multimodal)\b.{0,160}\b(?:unsupported|not supported|does not support|not accept|cannot accept|invalid content type)\b/is,
  /\b(?:unsupported|not supported|does not support|not accept|cannot accept|invalid content type)\b.{0,160}\b(?:images?|vision|multimodal)\b/is
]

const INHERITED_RETRY_CALL_OPTION_KEYS = [
  'maxOutputTokens',
  'temperature',
  'stopSequences',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
  'headers',
  'providerOptions'
] as const satisfies readonly (keyof LanguageModelRetryCallOptions)[]

function inheritRetryCallOptions(
  current: LanguageModelV3CallOptions,
  prompt: LanguageModelV3Prompt = current.prompt
): LanguageModelRetryCallOptions {
  const entries = INHERITED_RETRY_CALL_OPTION_KEYS.flatMap((key) =>
    current[key] === undefined ? [] : ([[key, current[key]]] as const)
  )
  return { ...Object.fromEntries(entries), prompt } as LanguageModelRetryCallOptions
}

function isImageInputRejection(error: unknown): error is APICallError {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false

  let data = ''
  try {
    data = typeof error.data === 'string' ? error.data : JSON.stringify(error.data ?? '')
  } catch {
    // Ignore non-serializable provider data; message/responseBody still carry
    // the normal AI SDK error details.
  }
  const detail = [error.message, error.responseBody, data].filter(Boolean).join('\n')
  return IMAGE_REJECTION_PATTERNS.some((pattern) => pattern.test(detail))
}

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
 * Returns a `wrapModel` closure when either recovery policy is enabled,
 * otherwise `undefined`.
 */
export function createRetryableWrap(options: CreateRetryableWrapOptions): WrapLanguageModel | undefined {
  if (!options.retryPolicy.enabled && !options.imageInputFallback) return undefined

  // `max_attempts` is the number of RETRIES (matches the "Max retry attempts"
  // setting and the embedding/rerank AI SDK `maxRetries`). The custom
  // transient retry below counts only retryable failures for this budget.
  const retryCount = options.retryPolicy.maxAttempts
  const backoffEnabled = options.retryPolicy.backoffEnabled

  const rewrittenPrompts = new WeakMap<LanguageModelV3Prompt, Promise<LanguageModelV3Prompt | null>>()
  const imageInputRetry: Retryable<LanguageModel> | undefined = options.imageInputFallback
    ? async (context) => {
        if (!isErrorAttempt(context.current) || !isImageInputRejection(context.current.error)) return undefined

        const prompt = context.current.options.prompt
        let rewritten = rewrittenPrompts.get(prompt)
        if (!rewritten) {
          rewritten = options.imageInputFallback!(prompt, context.current.options.abortSignal)
          rewrittenPrompts.set(prompt, rewritten)
        }
        const resolved = await rewritten
        if (!resolved || context.attempts.some((attempt) => attempt.options.prompt === resolved)) return undefined

        return {
          model: context.current.model,
          // The rewritten prompt is attempted once; the identity guard also
          // prevents a later fallback model from replaying the same recovery.
          maxAttempts: Number.MAX_SAFE_INTEGER,
          options: inheritRetryCallOptions(context.current.options, resolved)
        }
      }
    : undefined

  const transientRetryTemplate = options.retryPolicy.enabled
    ? error.isRetryable<LanguageModel>(true).retry({
        // `ai-retry` counts every same-model attempt, including the image 400
        // and OCR recovery. The wrapper below enforces the transient-only
        // budget, so keep the library's aggregate guard out of the way.
        maxAttempts: Number.MAX_SAFE_INTEGER,
        delay: RETRY_BASE_DELAY_MS,
        ...(backoffEnabled && { backoffFactor: 2 })
      })
    : undefined
  const transientRetry: Retryable<LanguageModel> | undefined = transientRetryTemplate
    ? async (context) => {
        const retry = await transientRetryTemplate(context)
        if (!retry) return undefined

        const currentModelKey = getModelKey(context.current.model)
        const transientFailures = context.attempts.filter(
          (attempt) =>
            getModelKey(attempt.model) === currentModelKey &&
            isErrorAttempt(attempt) &&
            APICallError.isInstance(attempt.error) &&
            attempt.error.isRetryable === true
        ).length
        if (transientFailures > retryCount) return undefined

        // Calculate backoff from transient failures only. Returning factor 1
        // prevents ai-retry from exponentiating again using all model calls.
        const delay =
          retry.backoffFactor === 1 || !backoffEnabled || retry.delay === undefined
            ? retry.delay
            : retry.delay * 2 ** transientFailures
        return {
          ...retry,
          maxAttempts: Number.MAX_SAFE_INTEGER,
          delay,
          backoffFactor: 1,
          options: inheritRetryCallOptions(context.current.options)
        }
      }
    : undefined

  const retries: Retries<LanguageModel> = [
    ...(imageInputRetry ? [imageInputRetry] : []),
    // Same-model transient retry on retryable errors: honors Retry-After headers,
    // otherwise delay + backoff.
    ...(transientRetry ? [transientRetry] : []),
    // Cross-model fallback, tried in user-configured order (one attempt each).
    // Resolved lazily on first failure (memoized) so the happy path pays nothing;
    // each fallback carries its own middleware + params (a per-retry override).
    // Error-only (like a plain-model fallback): ai-retry also evaluates function
    // retryables on *result* attempts (content-filter etc.), so guard on
    // `isErrorAttempt` to avoid resolving — and falsely retrying — on success.
    ...(options.retryPolicy.enabled ? options.fallbacks : []).map((resolveFallback): Retryable<LanguageModel> => {
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
