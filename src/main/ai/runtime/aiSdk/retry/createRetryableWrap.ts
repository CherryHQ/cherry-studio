/**
 * Builds the `wrapModel` closure that wraps a resolved chat model with
 * ai-retry: same-model transient retry (429/5xx/timeout with backoff)
 * first, then cross-model fallback to the user-configured retry models.
 *
 * Streaming caveat: ai-retry can only retry/fall back before the first
 * content chunk is emitted; mid-stream errors surface as stream errors.
 */
import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { application } from '@application'
import { resolveLanguageModel } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { APICallError } from 'ai'
import { createRetryable, isErrorAttempt, type RetryContext } from 'ai-retry'
import { retryAfterDelay } from 'ai-retry/retryables'

import { providerToAiSdkConfig } from '../../../provider/config'
import type { AppProviderSettingsMap } from '../../../types'

const logger = loggerService.withContext('ModelRetry')

export interface RetryEventPayload {
  modelId: string
  attempt: number
  reason: string
}

export type WrapLanguageModel = (model: LanguageModelV3) => LanguageModelV3

export interface CreateRetryableWrapOptions {
  /** Primary model identity, used to skip a fallback equal to the primary. */
  primaryProviderId: string
  primaryModelId: string
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

/** Resolve one fallback UniqueModelId into a model instance; null on failure (logged, skipped). */
async function resolveFallbackModel(uniqueModelId: UniqueModelId): Promise<LanguageModelV3 | null> {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const provider = await providerService.getByProviderId(providerId)
    const model = await modelService.getByKey(providerId, modelId)
    const cfg = await providerToAiSdkConfig(provider, model)
    const resolved = await resolveLanguageModel<AppProviderSettingsMap>(
      cfg.providerId,
      cfg.providerSettings,
      model.apiModelId ?? model.id
    )
    return resolved as LanguageModelV3
  } catch (error) {
    logger.warn('skipping unresolvable fallback model', { uniqueModelId, error })
    return null
  }
}

/**
 * Returns a `wrapModel` closure when retry is enabled, otherwise `undefined`.
 * Fallback models that fail to resolve are skipped without failing the request.
 */
export async function createRetryableWrap(options: CreateRetryableWrapOptions): Promise<WrapLanguageModel | undefined> {
  const preferences = application.get('PreferenceService')
  if (!preferences.get('chat.retry.enabled')) return undefined

  const maxAttempts = Math.max(1, preferences.get('chat.retry.max_attempts'))
  const backoffEnabled = preferences.get('chat.retry.backoff_enabled')
  const fallbackIds = preferences.get('chat.retry.fallback_model_ids').filter(isUniqueModelId)

  // Resolve fallbacks concurrently (this runs on the request path); Promise.all
  // preserves the user-configured order. Primary-equal entries are dropped.
  const fallbackModels = (
    await Promise.all(
      fallbackIds.map((uniqueModelId) => {
        const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
        if (providerId === options.primaryProviderId && modelId === options.primaryModelId) return null
        return resolveFallbackModel(uniqueModelId)
      })
    )
  ).filter((model): model is LanguageModelV3 => model !== null)

  return (base) =>
    createRetryable({
      model: base,
      retries: [
        // Same-model transient retry: honors Retry-After headers, otherwise delay + backoff.
        retryAfterDelay({
          maxAttempts,
          delay: RETRY_BASE_DELAY_MS,
          ...(backoffEnabled && { backoffFactor: 2 })
        }),
        // Cross-model fallback, tried in user-configured order (one attempt each).
        ...fallbackModels
      ],
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

/**
 * Same-model-only transient retry for embedding calls. No cross-model
 * fallback: vectors from different embedding models live in incompatible
 * spaces, so mixing them would corrupt the index.
 */
export function createEmbeddingRetryWrap(): ((model: EmbeddingModelV3) => EmbeddingModelV3) | undefined {
  const preferences = application.get('PreferenceService')
  if (!preferences.get('chat.retry.enabled')) return undefined

  const maxAttempts = Math.max(1, preferences.get('chat.retry.max_attempts'))
  const backoffEnabled = preferences.get('chat.retry.backoff_enabled')

  return (base) =>
    createRetryable({
      model: base,
      retries: [
        retryAfterDelay({
          maxAttempts,
          delay: RETRY_BASE_DELAY_MS,
          ...(backoffEnabled && { backoffFactor: 2 })
        })
      ],
      onRetry: (context) => {
        logger.info('retrying embedding call', {
          modelId: context.current.model.modelId,
          attempt: context.attempts.length
        })
      }
    })
}
