/**
 * Builds the `wrapModel` closure that wraps a resolved chat model with
 * ai-retry: same-provider API-key failover on 401/429 first, same-model
 * transient retry for other retryable API errors, then cross-model fallback.
 *
 * Fallbacks are built by the caller (`buildFallbackModels`) through
 * the same `buildAgentParams` pipeline as the primary, so each fallback model
 * already carries its own feature middleware and its own call-option overrides
 * (sampling / providerOptions / headers). This leaf only assembles the
 * ai-retry policy — it does not load providers/models itself.
 *
 * API-key failover is independent of the model retry preference. The model
 * retry condition does not handle request-scope timeout or abort errors.
 *
 * Streaming caveat: ai-retry can only retry/fall back before the first
 * content chunk is emitted. Mid-stream interruptions of plain-text replies are
 * resumed by `withStreamContinuation` (same retry budget); other mid-stream
 * errors surface as stream errors.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { APICallError, type ToolCallRepairFunction, type ToolSet, wrapLanguageModel } from 'ai'
import {
  isErrorAttempt,
  type LanguageModel,
  type LanguageModelRetryCallOptions,
  type Retries,
  type Retryable,
  type RetryContext
} from 'ai-retry'
import { and, createRetryableModel, error, not } from 'ai-retry/language-model'

import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'

import { getPendingReplayRoute, ToolContinuationRouteError } from '../../../provider/replayRoute'
import { getTerminalModelError } from '../../../utils/retryError'
import { outputTokenRetry } from './outputTokenRetry'
import type { RetryPolicy } from './retryPolicy'
import { withStreamContinuation } from './streamContinuation'

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
  replayRouteId?: string
  options?: FallbackCallOptions
  repairToolCall?: ToolCallRepairFunction<ToolSet>
}

/**
 * Lazily resolves a fallback on first failure. Building one is expensive
 * (per-fallback `buildAgentParams` — which can sync MCP tools — plus model
 * resolution), so the happy path must pay nothing. Resolves to `null` when the
 * fallback is gated out or unresolvable.
 */
export type FallbackResolver = () => Promise<RetryFallback | null>

export interface CreateRetryableWrapOptions {
  primaryReplayRouteId?: string
  /** Same-provider, same-model alternatives using the remaining enabled API keys. */
  apiKeyFallbacks?: FallbackResolver[]
  /**
   * Fallback resolvers in user-configured order. Each is invoked once (memoized)
   * after it successfully resolves. A `null` result is retried on the next
   * failure so a transient resolution problem does not disable that fallback.
   */
  fallbacks: FallbackResolver[]
  retryPolicy: RetryPolicy
  outputTokenRetries?: number
  /** Stable request identifiers attached to retry diagnostics. */
  diagnosticContext?: Readonly<Record<string, unknown>>
  /** Invoked when retry starts or settles (e.g. to reconcile a live UI status part). */
  onRetryEvent?: (event: RetryPartData) => void
  /**
   * Mid-stream resume of interrupted text output (default on). Callers whose
   * consumer cannot splice a continuation — structured-output transports that
   * parse the whole body as one document — disable it so a mid-stream failure
   * surfaces instead of re-issuing behind partial output.
   */
  streamContinuation?: boolean
  /**
   * The consumer's idle-chunk timeout (ms). While a resumed attempt is buffered the live retry status is the
   * only chunk the consumer sees, so its heartbeat interval is kept well under this bound.
   */
  idleTimeoutMs?: number
  shouldRetryError?: (error: unknown) => boolean
  /** Switches request-scoped helpers to the credential/model selected by a fallback. */
  onFallbackActivated?: (fallback: RetryFallback) => void
  /** Restores request-scoped helpers when a new operation starts from the primary model. */
  onPrimaryActivated?: () => void
}

const RETRY_BASE_DELAY_MS = 1_000
const BUFFERED_ACTIVITY_INTERVAL_MS = 5_000
const MIN_BUFFERED_ACTIVITY_INTERVAL_MS = 100

/** Heartbeat interval: 5s by default, shortened to a third of a smaller idle timeout so the timer never starves. */
export function bufferedActivityIntervalMs(idleTimeoutMs?: number): number {
  if (idleTimeoutMs === undefined || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    return BUFFERED_ACTIVITY_INTERVAL_MS
  }
  return Math.min(
    BUFFERED_ACTIVITY_INTERVAL_MS,
    Math.max(MIN_BUFFERED_ACTIVITY_INTERVAL_MS, Math.floor(idleTimeoutMs / 3))
  )
}

function lazyFallbackRetryable(
  resolveFallback: FallbackResolver,
  onFallbackActivated?: (fallback: RetryFallback) => void,
  wrapFallbackModel?: WrapLanguageModel,
  crossRoute = false
): Retryable<LanguageModel> {
  let cached: Promise<RetryFallback | null> | undefined
  return async (context) => {
    if (!isErrorAttempt(context.current)) return undefined
    if (crossRoute && getPendingReplayRoute(context.current.options.prompt)) return undefined
    cached ??= resolveFallback()
    const fallback = await cached
    if (!fallback) {
      cached = undefined
      return undefined
    }
    onFallbackActivated?.(fallback)
    const model = wrapFallbackModel?.(fallback.model) ?? fallback.model
    return fallback.options ? { model, options: fallback.options } : { model }
  }
}

function apiKeyFallbackRetryable(
  resolveFallbacks: FallbackResolver[],
  onFallbackActivated?: (fallback: RetryFallback) => void,
  wrapFallbackModel?: WrapLanguageModel,
  onExhausted?: (error: APICallError) => void
): Retryable<LanguageModel> {
  const resolvedFallbacks = resolveFallbacks.map((resolveFallback) =>
    lazyFallbackRetryable(resolveFallback, onFallbackActivated, wrapFallbackModel)
  )
  let nextFallbackIndex = 0
  return (context) => {
    if (!isErrorAttempt(context.current)) return undefined
    const terminalError = getTerminalModelError(context.current.error)
    if (
      !APICallError.isInstance(terminalError) ||
      (terminalError.statusCode !== 401 && terminalError.statusCode !== 429)
    ) {
      return undefined
    }
    const resolve = resolvedFallbacks[nextFallbackIndex]
    if (!resolve) {
      onExhausted?.(terminalError)
      return undefined
    }
    return Promise.resolve(resolve(context)).then((fallback) => {
      if (!fallback) return undefined
      nextFallbackIndex += 1
      return { ...fallback, maxAttempts: resolveFallbacks.length + 1 }
    })
  }
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
 * Returns a wrapper when model retry or API-key failover is available.
 */
export function createRetryableWrap(options: CreateRetryableWrapOptions): WrapLanguageModel | undefined {
  const apiKeyFallbacks = options.apiKeyFallbacks ?? []
  const outputRetries = options.outputTokenRetries ? [outputTokenRetry(options.outputTokenRetries)] : []
  if (
    !options.primaryReplayRouteId &&
    !options.retryPolicy.enabled &&
    !outputRetries.length &&
    !apiKeyFallbacks.length
  ) {
    return undefined
  }

  const fallbackResolvers = options.fallbacks.map((resolve) => {
    let result: Promise<RetryFallback | null> | undefined
    return async () => {
      result ??= resolve()
      try {
        const fallback = await result
        if (!fallback) result = undefined
        return fallback
      } catch (error) {
        result = undefined
        throw error
      }
    }
  })

  // `max_attempts` is the number of RETRIES (matches the "Max retry attempts"
  // setting and the embedding/rerank AI SDK `maxRetries`). ai-retry counts the
  // original call in `maxAttempts`, so +1 yields that many same-model retries.
  const retryCount = options.retryPolicy.maxAttempts
  const backoffEnabled = options.retryPolicy.backoffEnabled
  const retryScope = new AsyncLocalStorage<{ remaining: number }>()
  const takeRetry = () => {
    const budget = retryScope.getStore()
    return !budget || (budget.remaining > 0 && (budget.remaining--, true))
  }
  // Evaluate the native retry rule first. Consume only an eligible same-model retry,
  // not a result probe, exhausted per-model rule, API-key switch or model fallback.
  const budgeted =
    (retry: Retryable<LanguageModel>): Retryable<LanguageModel> =>
    async (context) => {
      const candidate = await retry(context)
      if (!candidate || !retryScope.getStore()) return candidate
      const model = candidate.model
      if (typeof model === 'string') return candidate
      const used = context.attempts.filter(
        (attempt) => attempt.model.provider === model.provider && attempt.model.modelId === model.modelId
      ).length
      if (used >= (candidate.maxAttempts ?? 1)) return undefined
      return takeRetry() ? candidate : undefined
    }
  const transientRetry = (
    apiKeyFallbacks.length > 0 ? and(error.isRetryable(true), not(error.statusCode(401, 429))) : error.isRetryable(true)
  ).retry({
    maxAttempts: retryCount + 1,
    delay: RETRY_BASE_DELAY_MS,
    ...(backoffEnabled && { backoffFactor: 2 })
  })
  const retryTransient: Retryable<LanguageModel> = async (context) => {
    if (isErrorAttempt(context.current) && options.shouldRetryError?.(context.current.error) === false) return
    const retry = await transientRetry(context)
    return (
      retry && {
        ...retry,
        model: context.current.model,
        options: outputRetries.length ? context.current.options : retry.options
      }
    )
  }
  const sameModelRetries: Retryable<LanguageModel>[] = [
    ...outputRetries,
    ...(options.retryPolicy.enabled ? [budgeted(retryTransient)] : [])
  ]
  const crossModelRetries = options.retryPolicy.enabled
    ? fallbackResolvers.map((fallback) => lazyFallbackRetryable(fallback, options.onFallbackActivated, undefined, true))
    : []

  return (base) => {
    const primary = options.onPrimaryActivated
      ? wrapLanguageModel({
          model: base,
          middleware: {
            specificationVersion: 'v3',
            transformParams: async ({ params }) => {
              options.onPrimaryActivated?.()
              return params
            }
          }
        })
      : base
    let retryActive = false
    const settleRetryStatus = () => {
      if (!retryActive) return
      retryActive = false
      options.onRetryEvent?.({ state: 'settled' })
    }
    const wrapApiKeyFallback: WrapLanguageModel | undefined = sameModelRetries.length
      ? (model) =>
          createRetryableModel({
            model,
            retries: sameModelRetries,
            onRetry: (context) => {
              const event = describeAttempt(context)
              logger.info('retrying model call', { ...options.diagnosticContext, ...event })
              retryActive = true
              options.onRetryEvent?.(event)
            }
          })
      : undefined
    let activeApiKeyModel = primary
    let activeApiKeyFallback: RetryFallback | undefined
    let exhaustedApiKeyError: APICallError | undefined
    const requestApiKeyModel: LanguageModelV3 = {
      specificationVersion: 'v3',
      get provider() {
        return activeApiKeyModel.provider
      },
      get modelId() {
        return activeApiKeyModel.modelId
      },
      get supportedUrls() {
        return activeApiKeyModel.supportedUrls
      },
      doGenerate: (callOptions) => {
        if (exhaustedApiKeyError) throw exhaustedApiKeyError
        if (activeApiKeyFallback) options.onFallbackActivated?.(activeApiKeyFallback)
        return activeApiKeyModel.doGenerate(callOptions)
      },
      doStream: (callOptions) => {
        if (exhaustedApiKeyError) throw exhaustedApiKeyError
        if (activeApiKeyFallback) options.onFallbackActivated?.(activeApiKeyFallback)
        return activeApiKeyModel.doStream(callOptions)
      }
    }

    const keyPoolModel =
      apiKeyFallbacks.length > 0
        ? createRetryableModel({
            model: requestApiKeyModel,
            retries: [
              apiKeyFallbackRetryable(
                apiKeyFallbacks,
                (fallback) => {
                  activeApiKeyFallback = fallback
                  options.onFallbackActivated?.(fallback)
                },
                (model) => {
                  activeApiKeyModel = wrapApiKeyFallback?.(model) ?? model
                  return activeApiKeyModel
                },
                (error) => {
                  exhaustedApiKeyError = error
                }
              )
            ],
            onRetry: (context) => {
              const event = { ...describeAttempt(context), modelId: base.modelId }
              logger.info('retrying model call with next API key', { ...options.diagnosticContext, ...event })
              retryActive = true
              options.onRetryEvent?.(event)
            },
            ...(!sameModelRetries.length && {
              onSuccess: settleRetryStatus,
              onFailure: settleRetryStatus
            })
          })
        : primary

    const wrapWithRetries = (model: LanguageModelV3, rules: Retries<LanguageModel>) =>
      createRetryableModel({
        model,
        retries: rules,
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
          settleRetryStatus()
          if (context.attempts.length === 1 && !options.retryPolicy.enabled) return
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
        }
      })
    const retries: Retries<LanguageModel> = [
      // Replacement credentials have already run both same-model rules together.
      ...sameModelRetries.map<Retryable<LanguageModel>>(
        (rule) => (context) =>
          activeApiKeyFallback && context.current.model === keyPoolModel ? undefined : rule(context)
      ),
      ...crossModelRetries
    ]
    const retryModel = retries.length > 0 ? wrapWithRetries(keyPoolModel, retries) : keyPoolModel

    const withReplayPin = (model: LanguageModelV3): LanguageModelV3 => {
      if (!options.primaryReplayRouteId) return model
      const resolvePinned = async (params: LanguageModelV3CallOptions) => {
        const route = getPendingReplayRoute(params.prompt)
        if (!route || route === options.primaryReplayRouteId) return undefined
        for (const resolve of fallbackResolvers) {
          const fallback = await resolve()
          if (fallback?.replayRouteId === route) {
            options.onFallbackActivated?.(fallback)
            return outputRetries.length
              ? { ...fallback, model: wrapWithRetries(fallback.model, outputRetries) }
              : fallback
          }
        }
        throw new ToolContinuationRouteError()
      }
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: 'v3',
          wrapGenerate: async ({ params, doGenerate }) => {
            const pinned = await resolvePinned(params)
            return pinned ? pinned.model.doGenerate({ ...params, ...pinned.options }) : doGenerate()
          },
          wrapStream: async ({ params, doStream }) => {
            const pinned = await resolvePinned(params)
            return pinned ? pinned.model.doStream({ ...params, ...pinned.options }) : doStream()
          }
        }
      })
    }

    const pinnedRetryableModel = withReplayPin(retryModel)

    return new Proxy(pinnedRetryableModel, {
      get(target, prop) {
        if (prop === 'doStream')
          return (callOptions: Parameters<LanguageModelV3['doStream']>[0]) => {
            const budget = { remaining: retryCount }
            const scopedModel = new Proxy(target, {
              get(model, key) {
                if (key === 'doStream')
                  return (params: Parameters<LanguageModelV3['doStream']>[0]) =>
                    retryScope.run(budget, () => model.doStream(params))
                const value = Reflect.get(model, key, model)
                return typeof value === 'function' ? value.bind(model) : value
              }
            })
            // The resumed request goes back through the fallback chain, which restarts at the primary and
            // can hand one model's partial answer to another with different options. Until a continuation
            // can be bound to the model, credential and options that produced the visible text, a chain
            // with model fallbacks surfaces the interruption instead of resuming.
            if (options.streamContinuation === false || options.fallbacks.length > 0) {
              return scopedModel.doStream(callOptions)
            }
            // With an API-key pool the resumed request is pinned to the key that produced the visible text:
            // it never goes back through the pool, so a 401/429 on the continuation surfaces the interruption
            // instead of handing that key's output to the next key, which may belong to another project.
            const resumeModel: LanguageModelV3 | undefined =
              apiKeyFallbacks.length > 0
                ? {
                    specificationVersion: 'v3',
                    provider: requestApiKeyModel.provider,
                    modelId: requestApiKeyModel.modelId,
                    supportedUrls: requestApiKeyModel.supportedUrls,
                    doGenerate: (params) => requestApiKeyModel.doGenerate(params),
                    doStream: (params) => {
                      if (exhaustedApiKeyError) throw exhaustedApiKeyError
                      return retryScope.run(budget, () => activeApiKeyModel.doStream(params))
                    }
                  }
                : undefined
            const operation = withStreamContinuation(scopedModel, {
              maxAttempts: retryCount,
              takeRetry: () => budget.remaining > 0 && (budget.remaining--, true),
              baseDelayMs: RETRY_BASE_DELAY_MS,
              backoffEnabled,
              ...(resumeModel && { resumeModel }),
              onRetry: ({ attempt, reason }) => {
                const event = { state: 'retrying' as const, modelId: base.modelId, attempt: attempt + 1, reason }
                lastRetryEvent = event
                logger.info('resuming interrupted stream', { ...options.diagnosticContext, ...event })
                retryActive = true
                options.onRetryEvent?.(event)
              },
              onSettled: settleRetryStatus,
              // Re-emit the live retry status (idempotent, same part id) so the stream manager's
              // idle-chunk timer sees activity while the resumed attempt is buffered.
              onBufferedActivity: () => {
                if (!retryActive || !lastRetryEvent) return
                const now = Date.now()
                const wait = lastActivityEmit + activityIntervalMs - now
                if (wait <= 0) {
                  lastActivityEmit = now
                  options.onRetryEvent?.(lastRetryEvent)
                  return
                }
                // A throttled delta still counts as activity: emit once at the end of the window, or the
                // idle timer would only see the earlier signal and abort a stream that is still delivering.
                if (trailingActivity) return
                trailingActivity = setTimeout(() => {
                  trailingActivity = undefined
                  if (!retryActive || !lastRetryEvent) return
                  lastActivityEmit = Date.now()
                  options.onRetryEvent?.(lastRetryEvent)
                }, wait)
              }
            })
            return operation.doStream(callOptions)
          }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  }
}
