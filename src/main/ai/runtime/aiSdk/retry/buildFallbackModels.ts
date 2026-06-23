/**
 * Builds the user-configured fallback models for chat retry.
 *
 * Each fallback is shaped through the SAME `buildAgentParams` pipeline as the
 * primary, so it carries its own feature middleware (applied by
 * `resolveLanguageModel(plugins)`) and its own call-option overrides (sampling /
 * providerOptions / headers) — not the primary's. Fallbacks that are the active
 * model, fail to resolve, or can't support the request shape (vision/tools) are
 * skipped (logged) and never fail the request. Returns `[]` when retry is
 * disabled or unconfigured.
 *
 * Note: the primary's tools + system are kept (the agent loop is built around
 * them and ai-retry can't re-shape them mid-call); the capability gate ensures a
 * skipped fallback never receives tools/images it can't handle.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { application } from '@application'
import { resolveLanguageModel } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { Assistant } from '@shared/data/types/assistant'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isFunctionCallingModel, isVisionModel } from '@shared/utils/model'

import type { AppProviderSettingsMap } from '../../../types'
import type { AgentOptions } from '../loop'
import { buildAgentParams, type BuildAgentParamsInput } from '../params/buildAgentParams'
import type { RequestFeature } from '../params/feature'
import type { FallbackCallOptions, FallbackResolver, RetryFallback } from './createRetryableWrap'

const logger = loggerService.withContext('ModelRetry')

export interface BuildFallbackModelsArgs {
  request: BuildAgentParamsInput['request']
  assistant: Assistant | undefined
  signal: AbortSignal | undefined
  /** Primary model's stored UniqueModelId — fallbacks equal to it are dropped. */
  primaryUniqueModelId: UniqueModelId
  /** Whether the active request resolved tools (gates non-function-calling fallbacks). */
  primaryHasTools: boolean
  /** Whether the request carries image input (gates non-vision fallbacks). */
  requestHasImages: boolean
  extraFeatures: readonly RequestFeature[]
}

/** Lifts the per-fallback call-option overrides from a fallback's resolved `AgentOptions`. */
function pickFallbackCallOptions(options: AgentOptions): FallbackCallOptions | undefined {
  const o: FallbackCallOptions = {}
  if (options.temperature !== undefined) o.temperature = options.temperature
  if (options.topP !== undefined) o.topP = options.topP
  if (options.topK !== undefined) o.topK = options.topK
  if (options.maxOutputTokens !== undefined) o.maxOutputTokens = options.maxOutputTokens
  if (options.stopSequences !== undefined) o.stopSequences = options.stopSequences
  if (options.seed !== undefined) o.seed = options.seed
  if (options.frequencyPenalty !== undefined) o.frequencyPenalty = options.frequencyPenalty
  if (options.presencePenalty !== undefined) o.presencePenalty = options.presencePenalty
  if (options.providerOptions !== undefined) {
    o.providerOptions = options.providerOptions as FallbackCallOptions['providerOptions']
  }
  if (options.headers !== undefined) o.headers = options.headers
  return Object.keys(o).length > 0 ? o : undefined
}

export function buildFallbackModels(args: BuildFallbackModelsArgs): FallbackResolver[] {
  const preferences = application.get('PreferenceService')
  if (!preferences.get('chat.retry.enabled')) return []

  return preferences
    .get('chat.retry.fallback_model_ids')
    .filter(isUniqueModelId)
    .filter((uniqueModelId) => uniqueModelId !== args.primaryUniqueModelId)
    .map((uniqueModelId) => () => resolveFallback(uniqueModelId, args))
}

async function resolveFallback(
  uniqueModelId: UniqueModelId,
  args: BuildFallbackModelsArgs
): Promise<RetryFallback | null> {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const provider = await providerService.getByProviderId(providerId)
    const model = await modelService.getByKey(providerId, modelId)

    if (args.requestHasImages && !isVisionModel(model)) {
      logger.info('skipping fallback without vision for an image request', { uniqueModelId })
      return null
    }
    if (args.primaryHasTools && !isFunctionCallingModel(model)) {
      logger.info('skipping non-function-calling fallback for a tool request', { uniqueModelId })
      return null
    }

    const { sdkConfig, plugins, options } = await buildAgentParams({
      request: args.request,
      signal: args.signal,
      provider,
      model,
      assistant: args.assistant,
      extraFeatures: args.extraFeatures
    })
    const resolved = await resolveLanguageModel<AppProviderSettingsMap>(
      sdkConfig.providerId,
      sdkConfig.providerSettings,
      sdkConfig.modelId,
      plugins
    )
    return { model: resolved as LanguageModelV3, options: pickFallbackCallOptions(options) }
  } catch (error) {
    logger.warn('skipping unresolvable fallback model', { uniqueModelId, error })
    return null
  }
}
