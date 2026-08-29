/**
 * Main-process translate service.
 *
 * Stateless orchestration — resolves the configured translate model, builds the
 * interpolated prompt, and gates the configured model parameters against that
 * model, all from main-side preferences/DataApi; then hands the stream off to
 * `AiStreamManager.streamPrompt` with a `WebContentsListener` keyed by the
 * renderer-supplied `translate:*` streamId.
 *
 * Renderer subscribers consume `ai.stream.chunk` / `done` / `error` events
 * filtered by that streamId; abort flows back through `ai.stream.abort`.
 *
 * Per CLAUDE.md's lifecycle-decision guide this is a **direct-import
 * singleton**, not a `BaseService` — no long-lived resources, no persistent
 * side effects. The thin IpcApi handler lives in
 * `src/main/ipc/handlers/translate.ts`.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { CallOverrides, SamplingSettings } from '@main/ai/types'
import { getTemperature, getTopP } from '@main/ai/utils/modelParameters'
import { type ResolvedReasoningKind, resolveSelection } from '@main/ai/utils/reasoningSerializers'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { translateLanguageService } from '@main/data/services/TranslateLanguageService'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId, isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { isQwenMTModel } from '@shared/utils/model'

import { WebContentsListener } from '../../ai/streamManager'

const logger = loggerService.withContext('TranslateService')

const NOT_CONFIGURED_ERROR = 'translate.error.not_configured'

/**
 * Namespaced prefix every translate stream uses for its `streamId` /
 * `topicId`. Defensive: ensures `ai.stream.abort({ topicId })` cannot collide
 * with a real chat topic id, and lets a future debugger filter logs by
 * "translate streams" without inspecting payloads. Kept in sync with the
 * renderer-side literal in `translateText.ts`.
 */
const TRANSLATE_STREAM_PREFIX = 'translate:'

// Which bucket the sampling gates should assume, resolved the way Main will resolve it. Guessing
// from the stored effort alone drops a parameter over thinking the model was never going to do.
function reasoningKindFor(effort: ReasoningEffortOption, model: Model): ResolvedReasoningKind {
  const resolved = resolveSelection(effort, model)
  if (resolved === undefined || resolved === 'default') return 'omit'
  if (resolved === 'none') return 'off'
  return 'effort'
}

export interface TranslateOpenRequest {
  /**
   * Renderer-generated streamId — must be prefixed `translate:`. The renderer
   * subscribes to `ai.stream.chunk` / `ai.stream.done` / `ai.stream.error` keyed
   * by this id **before** invoking `open`, so the first chunk cannot land
   * before the listener is attached.
   */
  streamId: string
  /** Source text to translate. */
  text: string
  /**
   * Target language code. Main is the single authority for the DTO lookup —
   * it resolves via `translateLanguageService.getByLangCode`, so renderers
   * never have to pre-fetch the DTO just to call translate.
   */
  targetLangCode: TranslateLangCode
}

export interface TranslateOpenResult {
  /** Streaming id; renderer filters `ai.stream.*` events by this. */
  streamId: string
}

interface ResolvedPayload {
  uniqueModelId: UniqueModelId
  /** Final prompt content. For Qwen MT this is the raw source text (the model handles language pairing). */
  content: string
  /** Carried out so `open` can gate the sampling settings against this model's capabilities. */
  model: Model
}

export class TranslateService {
  /**
   * IPC entry-point (called from `AiService.onInit`). Resolves the model +
   * prompt, then dispatches the stream through `AiStreamManager.streamPrompt`.
   * Returns the `streamId` synchronously so the renderer can subscribe to
   * `ai.stream.chunk` / `ai.stream.done` / `ai.stream.error` before chunks
   * start flowing.
   */
  open(sender: Electron.WebContents, req: TranslateOpenRequest): TranslateOpenResult {
    if (!req.streamId.startsWith(TRANSLATE_STREAM_PREFIX)) {
      throw new Error(`streamId must be prefixed '${TRANSLATE_STREAM_PREFIX}' (got '${req.streamId}')`)
    }
    if (!isTranslateLangCode(req.targetLangCode) || req.targetLangCode === 'unknown') {
      throw new Error(`Invalid target language: ${req.targetLangCode}`)
    }
    const targetLanguage = translateLanguageService.getByLangCode(req.targetLangCode)
    const { uniqueModelId, content, model } = this.resolveTranslatePayload(req.text, targetLanguage)
    const { reasoningEffort, callOverrides } = this.resolveRequestParameters(model)

    const wcListener = new WebContentsListener(sender, req.streamId)

    const streamManager = application.get('AiStreamManager')
    streamManager.streamPrompt({
      streamId: req.streamId,
      uniqueModelId,
      prompt: content,
      listener: wcListener,
      reasoningEffort,
      callOverrides
    })

    // `info`, and with the overrides: this is the only record of what translate
    // actually put on the request, and `resolveReasoningInvocation` logs the
    // reasoning it ends up sending separately.
    logger.info('translate stream opened', {
      streamId: req.streamId,
      uniqueModelId,
      reasoningEffort,
      callOverrides
    })
    return { streamId: req.streamId }
  }

  /**
   * Read the translate model parameters and gate them against the model.
   *
   * Sampling rides `callOverrides` because `streamPrompt` offers no other
   * channel for a caller without an assistant — the field exists for exactly
   * that (`CallOverrides`, used by the API gateway). Downstream re-gating drops
   * only `topK` (`filterStandardParams`), so temperature, topP and
   * maxOutputTokens reach the wire as given and translate has to gate them here.
   *
   * That forces the gate to run before the pipeline resolves reasoning, which an
   * assistant's settings never do — `buildAgentParams` gates them after. Sharing
   * `resolveSelection` closes the model half of that gap. The wire half stays
   * open: a profile with no mode for the selection, or a thinking budget the
   * output cap cannot satisfy, still reads as active here and omits downstream,
   * so a translation can lose a temperature it should have kept. #19693 is the
   * exit — it moves this gate inside the pipeline, where both halves are known.
   */
  resolveRequestParameters(model: Model): { reasoningEffort: ReasoningEffortOption; callOverrides: CallOverrides } {
    const preferenceService = application.get('PreferenceService')
    const reasoningEffort = preferenceService.get('feature.translate.reasoning_effort')
    const settings = {
      temperature: preferenceService.get('feature.translate.temperature'),
      enableTemperature: preferenceService.get('feature.translate.enable_temperature'),
      topP: preferenceService.get('feature.translate.top_p'),
      enableTopP: preferenceService.get('feature.translate.enable_top_p'),
      maxTokens: preferenceService.get('feature.translate.max_tokens'),
      enableMaxTokens: preferenceService.get('feature.translate.enable_max_tokens')
    } satisfies SamplingSettings

    const reasoning = { kind: reasoningKindFor(reasoningEffort, model) }
    const temperature = getTemperature(settings, model, reasoning)
    const topP = getTopP(settings, model, reasoning)

    return {
      reasoningEffort,
      callOverrides: {
        ...(temperature !== undefined && { temperature }),
        ...(topP !== undefined && { topP }),
        ...(settings.enableMaxTokens && { maxOutputTokens: settings.maxTokens })
      }
    }
  }

  /**
   * Resolve the configured translate model + interpolate the translate prompt.
   *
   * Reads `feature.translate.model_id` from Preference and fetches the
   * matching model row via the main `modelService`. Qwen MT models bypass
   * prompt interpolation (the model handles language pairing itself) —
   * matches the renderer-side v1 behaviour.
   */
  resolveTranslatePayload(text: string, targetLanguage: TranslateLanguage): ResolvedPayload {
    const preferenceService = application.get('PreferenceService')
    const modelIdRaw = preferenceService.get('feature.translate.model_id')
    if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) {
      throw new Error(NOT_CONFIGURED_ERROR)
    }
    const { providerId, modelId } = parseUniqueModelId(modelIdRaw)
    let provider: ReturnType<typeof providerService.getByProviderId> | undefined
    let model: ReturnType<typeof modelService.getByKey> | undefined
    try {
      provider = providerService.getByProviderId(providerId)
      model = modelService.getByKey(providerId, modelId)
    } catch {
      provider = undefined
      model = undefined
    }
    if (!provider || !model) {
      throw new Error(NOT_CONFIGURED_ERROR)
    }
    const uniqueModelId = createUniqueModelId(providerId, modelId)
    const content = isQwenMTModel(model)
      ? text
      : preferenceService
          .get('feature.translate.model_prompt')
          .replaceAll(/{{target_language}}|{{text}}/g, (placeholder) =>
            placeholder === '{{target_language}}' ? targetLanguage.value : text
          )

    return { uniqueModelId, content, model }
  }
}

export const translateService = new TranslateService()
