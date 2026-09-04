/**
 * Builds the user-configured fallback models for chat retry.
 *
 * Each fallback is shaped through the SAME `buildAgentParams` pipeline as the
 * primary, so it carries its own feature middleware (applied by
 * `resolveLanguageModel(plugins)`) and its own call-option overrides (sampling /
 * providerOptions / headers) — not the primary's. Fallbacks that are the active
 * model, were deleted, or can't support the request shape (native media/tools)
 * are skipped with diagnostics. Unexpected resolution errors still fail the
 * request. Returns `[]` when retry is disabled or unconfigured.
 *
 * Note: the primary's tools + system are kept (the agent loop is built around
 * them and ai-retry can't re-shape them mid-call); the capability gate ensures a
 * skipped fallback never receives a native request shape it can't handle.
 */
import { resolveLanguageModel } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { isAbortError } from '@main/utils/error'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { Assistant } from '@shared/data/types/assistant'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isAudioModel, isFunctionCallingModel, isVideoModel, isVisionModel } from '@shared/utils/model'

import type { AiBaseRequest, AppProviderSettingsMap } from '../../../types'
import type { AgentOptions } from '../loop/types'
import { buildAgentParams } from '../params/buildAgentParams'
import type { RequestFeature } from '../params/feature'
import type { NativeFileSupport } from '../params/nativeFileSupport'
import type { FallbackCallOptions, FallbackResolver, RetryFallback } from './createRetryableWrap'
import type { RetryPolicy } from './retryPolicy'

const logger = loggerService.withContext('ModelRetry')

export interface BuildFallbackModelsArgs {
  // Base request shape accepted by `buildAgentParams`; kept `messages`-agnostic so
  // both streamText (UIMessage[]) and generateText (ModelMessage[]) requests fit.
  request: AiBaseRequest & { chatId?: string; messageId?: string }
  assistant: Assistant | undefined
  signal: AbortSignal | undefined
  /** Primary model's stored UniqueModelId — fallbacks equal to it are dropped. */
  primaryUniqueModelId: UniqueModelId
  /** Whether the active request resolved tools (gates non-function-calling fallbacks). */
  primaryHasTools: boolean
  /** Native attachment shapes preserved for the primary and replayed to fallbacks. */
  requiredNativeFileSupport: NativeFileSupport
  extraFeatures: readonly RequestFeature[]
  retryPolicy: RetryPolicy
}

const FALLBACK_CALL_OPTION_KEYS = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'stopSequences',
  'seed',
  'frequencyPenalty',
  'presencePenalty',
  'providerOptions',
  'headers'
] as const satisfies readonly (keyof AgentOptions & keyof FallbackCallOptions)[]

/** Lifts the per-fallback call-option overrides from a fallback's resolved `AgentOptions`. */
function pickFallbackCallOptions(options: AgentOptions): FallbackCallOptions | undefined {
  const entries = FALLBACK_CALL_OPTION_KEYS.flatMap((key) =>
    options[key] === undefined ? [] : ([[key, options[key]]] as const)
  )
  return entries.length > 0 ? (Object.fromEntries(entries) as FallbackCallOptions) : undefined
}

export function buildFallbackModels(args: BuildFallbackModelsArgs): FallbackResolver[] {
  if (!args.retryPolicy.enabled) return []

  const seen = new Set<UniqueModelId>()
  const resolvers: FallbackResolver[] = []
  for (const configuredId of args.retryPolicy.fallbackModelIds) {
    if (!isUniqueModelId(configuredId)) {
      logger.warn('skipping invalid fallback model id', { configuredId })
      continue
    }
    if (configuredId === args.primaryUniqueModelId) {
      logger.info('skipping fallback equal to the active model', { uniqueModelId: configuredId })
      continue
    }
    if (seen.has(configuredId)) {
      logger.info('skipping duplicate fallback model', { uniqueModelId: configuredId })
      continue
    }
    seen.add(configuredId)
    resolvers.push(() => resolveFallback(configuredId, args))
  }
  return resolvers
}

function resolveConfiguredFallback(uniqueModelId: UniqueModelId) {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  try {
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    return { provider, model }
  } catch (error) {
    if (isAbortError(error)) throw error
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      logger.error('skipping fallback whose provider or model no longer exists', error, { uniqueModelId })
      return null
    }
    throw error
  }
}

async function resolveFallback(
  uniqueModelId: UniqueModelId,
  args: BuildFallbackModelsArgs
): Promise<RetryFallback | null> {
  const configured = resolveConfiguredFallback(uniqueModelId)
  if (!configured) return null
  const { provider, model } = configured

  const required = args.requiredNativeFileSupport
  if (required.image && !isVisionModel(model)) {
    logger.info('skipping fallback without vision for an image request', { uniqueModelId })
    return null
  }
  if (required.video && !isVideoModel(model)) {
    logger.info('skipping fallback without video input for a video request', { uniqueModelId })
    return null
  }
  if (required.audio && !isAudioModel(model)) {
    logger.info('skipping fallback without audio input for an audio request', { uniqueModelId })
    return null
  }
  if (args.primaryHasTools && !isFunctionCallingModel(model)) {
    logger.info('skipping non-function-calling fallback for a tool request', { uniqueModelId })
    return null
  }

  const { sdkConfig, plugins, options, nativeFileSupport } = await buildAgentParams({
    request: args.request,
    signal: args.signal,
    provider,
    model,
    assistant: args.assistant,
    extraFeatures: args.extraFeatures
  })
  const unsupportedNativeType = (Object.keys(required) as Array<keyof NativeFileSupport>).find(
    (type) => required[type] && !nativeFileSupport[type]
  )
  if (unsupportedNativeType) {
    logger.info('skipping fallback without required native file support', {
      uniqueModelId,
      fileType: unsupportedNativeType
    })
    return null
  }

  const resolved = await resolveLanguageModel<AppProviderSettingsMap>(
    sdkConfig.providerId,
    sdkConfig.providerSettings,
    sdkConfig.modelId,
    plugins
  )
  return { model: resolved, options: pickFallbackCallOptions(options), repairToolCall: options.repairToolCall }
}
