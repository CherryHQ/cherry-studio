/**
 * Main-process translate service.
 *
 * Stateless orchestration — resolves the configured translate model + builds
 * the interpolated prompt from main-side preferences/DataApi, then hands the
 * stream off to `AiStreamManager.streamPrompt` with a `WebContentsListener`
 * keyed by a fresh `translate:${uuid}` streamId.
 *
 * Renderer subscribers consume chunks/done/error via the existing chat-stream
 * IPC channels (`Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError`)
 * filtered by that streamId; abort flows back through `Ai_Stream_Abort`.
 *
 * Per CLAUDE.md's lifecycle-decision guide this is a **direct-import
 * singleton**, not a `BaseService` — no long-lived resources, no persistent
 * side effects. The IPC handler is registered by `AiService.onInit` (which
 * already owns the AI-domain IPC surface).
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { translateLanguageService } from '@main/data/services/TranslateLanguageService'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId, isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { isQwenMTModel } from '@shared/utils/model'

import { PersistenceListener } from '../../ai/stream-manager/listeners/PersistenceListener'
import { WebContentsListener } from '../../ai/stream-manager/listeners/WebContentsListener'
import { TranslationBackend } from '../../ai/stream-manager/persistence/backends/TranslationBackend'
import type { StreamListener } from '../../ai/stream-manager/types'

const logger = loggerService.withContext('TranslateService')

const NOT_CONFIGURED_ERROR = 'translate.error.not_configured'

/**
 * Namespaced prefix every translate stream uses for its `streamId` /
 * `topicId`. Defensive: ensures `Ai_Stream_Abort({ topicId })` cannot collide
 * with a real chat topic id, and lets a future debugger filter logs by
 * "translate streams" without inspecting payloads. Kept in sync with the
 * renderer-side literal in `TranslateService.ts`.
 */
const TRANSLATE_STREAM_PREFIX = 'translate:'

export interface TranslateOpenRequest {
  /**
   * Renderer-generated streamId — must be prefixed `translate:`. The renderer
   * subscribes to `Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError` keyed
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
  /**
   * When present, attach a `PersistenceListener` + `TranslationBackend` to
   * the stream so the final accumulated translation is written onto this
   * message's `data.parts` as a `data-translation` part. Used by the
   * MessageMenubar "translate this reply" flow. Omit for orphan callers
   * (ActionTranslate, TranslatePage) — they keep the chunks-only contract.
   */
  messageId?: string
  /**
   * Optional source language passed through to the persisted
   * `data-translation` part. Renderers that already detected the source
   * (e.g. selection translate) can preserve it on the message row.
   */
  sourceLangCode?: TranslateLangCode
}

export interface TranslateOpenResult {
  /** Streaming id; renderer filters `Ai_Stream*` events by this. */
  streamId: string
}

interface ResolvedPayload {
  uniqueModelId: UniqueModelId
  /** Final prompt content. For Qwen MT this is the raw source text (the model handles language pairing). */
  content: string
}

export class TranslateService {
  /**
   * IPC entry-point (called from `AiService.onInit`). Resolves the model +
   * prompt, then dispatches the stream through `AiStreamManager.streamPrompt`.
   * Returns the `streamId` synchronously so the renderer can subscribe to
   * `Ai_StreamChunk/Done/Error` before chunks start flowing.
   */
  async open(sender: Electron.WebContents, req: TranslateOpenRequest): Promise<TranslateOpenResult> {
    if (!req.streamId.startsWith(TRANSLATE_STREAM_PREFIX)) {
      throw new Error(`streamId must be prefixed '${TRANSLATE_STREAM_PREFIX}' (got '${req.streamId}')`)
    }
    if (!isTranslateLangCode(req.targetLangCode) || req.targetLangCode === 'unknown') {
      throw new Error(`Invalid target language: ${req.targetLangCode}`)
    }
    const targetLanguage = await translateLanguageService.getByLangCode(req.targetLangCode)
    const { uniqueModelId, content } = await this.resolveTranslatePayload(req.text, targetLanguage)

    const listeners: StreamListener[] = []
    if (req.messageId) {
      listeners.push(
        new PersistenceListener({
          topicId: req.streamId,
          backend: new TranslationBackend({
            messageId: req.messageId,
            targetLanguage: req.targetLangCode,
            sourceLanguage: req.sourceLangCode
          })
        })
      )
    }
    listeners.push(new WebContentsListener(sender, req.streamId))

    const streamManager = application.get('AiStreamManager')
    streamManager.streamPrompt({ streamId: req.streamId, uniqueModelId, prompt: content, listener: listeners })

    logger.debug('translate stream opened', {
      streamId: req.streamId,
      uniqueModelId,
      messageId: req.messageId ?? null
    })
    return { streamId: req.streamId }
  }

  /**
   * Resolve the configured translate model + interpolate the translate prompt.
   *
   * Reads `feature.translate.model_id` from Preference and fetches the
   * matching model row via the main `modelService`. Qwen MT models bypass
   * prompt interpolation (the model handles language pairing itself) —
   * matches the renderer-side v1 behaviour.
   */
  async resolveTranslatePayload(text: string, targetLanguage: TranslateLanguage): Promise<ResolvedPayload> {
    const preferenceService = application.get('PreferenceService')
    const modelIdRaw = preferenceService.get('feature.translate.model_id')
    if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) {
      throw new Error(NOT_CONFIGURED_ERROR)
    }
    const { providerId, modelId } = parseUniqueModelId(modelIdRaw)
    const model = await modelService.getByKey(providerId, modelId).catch(() => undefined)
    if (!model) {
      throw new Error(NOT_CONFIGURED_ERROR)
    }
    const uniqueModelId = createUniqueModelId(providerId, modelId)

    const content = isQwenMTModel(model)
      ? text
      : preferenceService
          .get('feature.translate.model_prompt')
          .replaceAll('{{target_language}}', targetLanguage.value)
          .replaceAll('{{text}}', text)

    return { uniqueModelId, content }
  }
}

export const translateService = new TranslateService()
