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
 * content chunk is emitted; mid-stream errors surface as stream errors.
 */
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
import { chatStreamOptionsRetry, chatTokenFieldRetry } from './chatRequestRepair'
import { outputTokenRetry } from './outputTokenRetry'
import { createModelRetryEvents } from './retryEvents'
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
  requestRepairRetries?: number
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
  const requestRepairs = options.requestRepairRetries
    ? [
        chatTokenFieldRetry(options.requestRepairRetries),
        chatStreamOptionsRetry(options.requestRepairRetries),
        outputTokenRetry(options.requestRepairRetries)
      ]
    : []
  if (
    !options.primaryReplayRouteId &&
    !options.retryPolicy.enabled &&
    !requestRepairs.length &&
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
        options: requestRepairs.length ? context.current.options : retry.options
      }
    )
  }
  const sameModelRetries: Retryable<LanguageModel>[] = [
    ...requestRepairs,
    ...(options.retryPolicy.enabled ? [retryTransient] : [])
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
              model: requestRepairs.length ? wrapWithRetries(model, requestRepairs) : model,
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

    return wrapLanguageModel({
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
  }
}
