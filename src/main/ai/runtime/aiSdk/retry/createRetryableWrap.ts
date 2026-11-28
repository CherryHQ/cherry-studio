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
  type Retryable
} from 'ai-retry'
import { and, createRetryableModel, error, not } from 'ai-retry/language-model'

import { loggerService } from '@logger'
import type { RetryPartData } from '@shared/data/types/uiParts'

import { getPendingReplayRoute, ToolContinuationRouteError } from '../../../provider/replayRoute'
import { getTerminalModelError } from '../../../utils/retryError'
import { outputTokenRetry } from './outputTokenRetry'
import { createModelRetryEvents } from './retryEvents'
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
  /** Stable request identifiers attached to retry diagnostics. */
  diagnosticContext?: Readonly<Record<string, unknown>>
  /** Invoked when retry starts or settles (e.g. to reconcile a live UI status part). */
  onRetryEvent?: (event: RetryPartData) => void
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

function rememberFallback(resolve: FallbackResolver): FallbackResolver {
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
}

function withActivation(model: LanguageModelV3, activate?: () => void): LanguageModelV3 {
  if (!activate) return model
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => {
        params.abortSignal?.throwIfAborted()
        activate()
        return params
      }
    }
  })
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

  const fallbackResolvers = options.fallbacks.map(rememberFallback)
  const credentialResolvers = apiKeyFallbacks.map(rememberFallback)

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
  const transientRetry = and(
    error((cause) => options.shouldRetryError?.(cause) !== false),
    error.isRetryable(true),
    ...(apiKeyFallbacks.length > 0 ? [not(error.statusCode(401, 429))] : [])
  ).retry({
    maxAttempts: retryCount + 1,
    delay: RETRY_BASE_DELAY_MS,
    ...(backoffEnabled && { backoffFactor: 2 })
  })
  const retryTransient: Retryable<LanguageModel> = async (context) => {
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
  const canSwitchModel = error((_cause, { current }) => !getPendingReplayRoute(current.options.prompt))
  const crossModelRetries = options.retryPolicy.enabled
    ? fallbackResolvers.map<Retryable<LanguageModel>>((resolve) => async (context) => {
        if (!(await canSwitchModel.evaluate(context))) return
        const fallback = await resolve()
        if (!fallback) return
        const model = withActivation(fallback.model, () => options.onFallbackActivated?.(fallback))
        return { model, options: fallback.options }
      })
    : []

  return (base) => {
    const primary = withActivation(base, options.onPrimaryActivated)
    let activeCredential: { index: number; fallback: RetryFallback } | undefined
    let exhaustedApiKeyError: APICallError | undefined
    let retryActive = false
    let lastRetryEvent: RetryPartData | undefined
    let lastActivityEmit = 0
    let trailingActivity: ReturnType<typeof setTimeout> | undefined
    const activityIntervalMs = bufferedActivityIntervalMs(options.idleTimeoutMs)
    const settleRetryStatus = () => {
      if (!retryActive) return
      retryActive = false
      if (trailingActivity) clearTimeout(trailingActivity)
      trailingActivity = undefined
      // A settled badge must not be replayed by a late buffered-activity heartbeat.
      lastRetryEvent = undefined
      options.onRetryEvent?.({ state: 'settled' })
    }

    const createCall = async (
      params: LanguageModelV3CallOptions,
      events: ReturnType<typeof createModelRetryEvents>
    ) => {
      const onRetry = events.report
      const wrapWithRetries = (model: LanguageModelV3, retries: Retries<LanguageModel>) =>
        createRetryableModel({
          model,
          retries,
          onRetry,
          onError: events.reportError,
          onFailure: (context) => {
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

      const route = options.primaryReplayRouteId ? getPendingReplayRoute(params.prompt) : undefined
      if (route && route !== options.primaryReplayRouteId) {
        for (const resolve of fallbackResolvers) {
          const fallback = await resolve()
          if (fallback?.replayRouteId === route) {
            const model = withActivation(fallback.model, () => options.onFallbackActivated?.(fallback))
            return {
              model: outputRetries.length ? wrapWithRetries(model, outputRetries) : model,
              params: { ...params, ...fallback.options }
            }
          }
        }
        throw new ToolContinuationRouteError()
      }

      let selectedCredential = activeCredential
      const wrapCredential = (candidate: NonNullable<typeof activeCredential>) => {
        const model = withActivation(candidate.fallback.model, () => {
          selectedCredential = candidate
          activeCredential = candidate
          options.onFallbackActivated?.(candidate.fallback)
        })
        return sameModelRetries.length ? createRetryableModel({ model, retries: sameModelRetries, onRetry }) : model
      }

      const keyPoolModel = credentialResolvers.length
        ? createRetryableModel({
            model: exhaustedApiKeyError
              ? withActivation(base, () => {
                  throw exhaustedApiKeyError
                })
              : selectedCredential
                ? wrapCredential(selectedCredential)
                : primary,
            retries: [
              async ({ current }) => {
                if (!isErrorAttempt(current)) return
                const error = getTerminalModelError(current.error)
                if (!APICallError.isInstance(error) || (error.statusCode !== 401 && error.statusCode !== 429)) return
                const index = (selectedCredential?.index ?? -1) + 1
                const resolve = credentialResolvers[index]
                if (!resolve) {
                  exhaustedApiKeyError = error
                  return
                }
                const fallback = await resolve()
                if (!fallback) return
                return {
                  model: wrapCredential({ index, fallback }),
                  options: fallback.options,
                  maxAttempts: credentialResolvers.length + 1
                }
              }
            ],
            onRetry: (context) => onRetry(context, base.modelId),
            onError: sameModelRetries.length || crossModelRetries.length ? undefined : events.reportError
          })
        : primary

      const retries: Retries<LanguageModel> = [
        // A replacement key already runs the same-model rules under its own attempt budget.
        ...sameModelRetries.map<Retryable<LanguageModel>>(
          (rule) => (context) =>
            selectedCredential && context.current.model === keyPoolModel ? undefined : rule(context)
        ),
        ...crossModelRetries
      ]
      return { model: retries.length ? wrapWithRetries(keyPoolModel, retries) : keyPoolModel, params }
    }

    const retryModel = wrapLanguageModel({
      model: base,
      middleware: {
        specificationVersion: 'v3',
        wrapGenerate: async ({ params }) => {
          const events = createModelRetryEvents(options.onRetryEvent, options.diagnosticContext, params.abortSignal)
          try {
            const call = await createCall(params, events)
            return await call.model.doGenerate(call.params)
          } finally {
            events.settle()
          }
        },
        wrapStream: async ({ params }) => {
          const events = createModelRetryEvents(options.onRetryEvent, options.diagnosticContext, params.abortSignal)
          try {
            const call = await createCall(params, events)
            return events.observeStream(await call.model.doStream(call.params))
          } catch (error) {
            events.settle()
            throw error
          }
        }
      }
    })

    return new Proxy(retryModel, {
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
            const activeModel = () => (activeCredential ? activeCredential.fallback.model : base)
            const resumeModel: LanguageModelV3 | undefined =
              apiKeyFallbacks.length > 0
                ? {
                    specificationVersion: 'v3',
                    provider: activeModel().provider,
                    modelId: activeModel().modelId,
                    supportedUrls: activeModel().supportedUrls,
                    doGenerate: (params) => activeModel().doGenerate(params),
                    doStream: (params) => {
                      if (exhaustedApiKeyError) throw exhaustedApiKeyError
                      return retryScope.run(budget, () => activeModel().doStream(params))
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
