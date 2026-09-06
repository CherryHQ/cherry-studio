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
import { resolveEffectiveEndpoint, resolveEndpointProviderOptionsKey } from '@main/ai/provider/endpoint'
import type { CallOverrides } from '@main/ai/types'
import { type GatedSampling, getTemperature, getTopP } from '@main/ai/utils/modelParameters'
import {
  normalizeRequestedSelection,
  type ResolvedReasoningKind,
  resolveSelection
} from '@main/ai/utils/reasoningSerializers'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { translateLanguageService } from '@main/data/services/TranslateLanguageService'
import { isTranslateLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  isUniqueModelId,
  type Model,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import type { TranslateLanguage } from '@shared/data/types/translate'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { getLowerBaseModelName, getRawModelId, isQwenMTModel } from '@shared/utils/model'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import type { UIMessageChunk } from 'ai'

import {
  type StreamDoneResult,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult,
  WebContentsListener
} from '../../ai/streamManager'

const logger = loggerService.withContext('TranslateService')

const NOT_CONFIGURED_ERROR = 'translate.error.not_configured'
const NOT_SUPPORTED_ERROR = 'translate.error.not_supported'

const QWEN_MT_TARGET_LANGUAGES: Readonly<Record<string, string>> = {
  zh: 'Chinese',
  zh_tw: 'Traditional Chinese',
  en: 'English',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  de: 'German',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  ar: 'Arabic',
  hi: 'Hindi',
  he: 'Hebrew',
  my: 'Burmese',
  ta: 'Tamil',
  ur: 'Urdu',
  bn: 'Bengali',
  pl: 'Polish',
  nl: 'Dutch',
  ro: 'Romanian',
  tr: 'Turkish',
  km: 'Khmer',
  lo: 'Lao',
  yue: 'Cantonese',
  cs: 'Czech',
  el: 'Greek',
  sv: 'Swedish',
  hu: 'Hungarian',
  da: 'Danish',
  fi: 'Finnish',
  uk: 'Ukrainian',
  bg: 'Bulgarian',
  sr: 'Serbian',
  te: 'Telugu',
  af: 'Afrikaans',
  hy: 'Armenian',
  as: 'Assamese',
  ast: 'Asturian',
  eu: 'Basque',
  be: 'Belarusian',
  bs: 'Bosnian',
  ca: 'Catalan',
  ceb: 'Cebuano',
  hr: 'Croatian',
  arz: 'Egyptian Arabic',
  et: 'Estonian',
  gl: 'Galician',
  ka: 'Georgian',
  gu: 'Gujarati',
  is: 'Icelandic',
  jv: 'Javanese',
  kn: 'Kannada',
  kk: 'Kazakh',
  lv: 'Latvian',
  lt: 'Lithuanian',
  lb: 'Luxembourgish',
  mk: 'Macedonian',
  mai: 'Maithili',
  mt: 'Maltese',
  mr: 'Marathi',
  acm: 'Mesopotamian Arabic',
  ary: 'Moroccan Arabic',
  ars: 'Najdi Arabic',
  ne: 'Nepali',
  az: 'North Azerbaijani',
  apc: 'North Levantine Arabic',
  uz: 'Northern Uzbek',
  nb: 'Norwegian Bokmål',
  nn: 'Norwegian Nynorsk',
  oc: 'Occitan',
  or: 'Odia',
  pag: 'Pangasinan',
  scn: 'Sicilian',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  ajp: 'South Levantine Arabic',
  sw: 'Swahili',
  tl: 'Tagalog',
  acq: 'Ta’izzi-Adeni Arabic',
  sq: 'Tosk Albanian',
  aeb: 'Tunisian Arabic',
  vec: 'Venetian',
  war: 'Waray',
  cy: 'Welsh',
  fa: 'Western Persian'
}

const QWEN_MT_LITE_LANGUAGE_CODES = new Set([
  'zh',
  'zh_tw',
  'en',
  'ru',
  'ja',
  'ko',
  'es',
  'fr',
  'pt',
  'de',
  'it',
  'th',
  'vi',
  'id',
  'ms',
  'ar',
  'hi',
  'he',
  'ur',
  'bn',
  'pl',
  'nl',
  'tr',
  'km',
  'cs',
  'sv',
  'hu',
  'da',
  'fi',
  'tl',
  'fa'
])

function qwenMtModelId(model: Model): string {
  return getLowerBaseModelName(getRawModelId(model))
}

function isQwenMtLiteModel(model: Model): boolean {
  return /^qwen-mt-lite(?:$|[-:])/.test(qwenMtModelId(model))
}

function isQwenMtIncrementalModel(model: Model): boolean {
  return /^qwen-mt-(?:flash|lite)(?:$|[-:])/.test(qwenMtModelId(model))
}

function isQwenMtCumulativeModel(model: Model): boolean {
  return /^qwen-mt-(?:plus|turbo)(?:$|[-:])/.test(qwenMtModelId(model))
}

function qwenMtLanguageCode(language: TranslateLanguage): string {
  if (language.langCode === 'zh-cn' || language.langCode === 'zh') return 'zh'
  if (language.langCode === 'zh-tw') return 'zh_tw'
  if (language.langCode === 'zh-yue') return 'yue'
  return language.langCode.split('-')[0]
}

function resolveQwenMtTargetLanguage(language: TranslateLanguage, model: Model): string | undefined {
  const languageCode = qwenMtLanguageCode(language)
  if (isQwenMtLiteModel(model) && !QWEN_MT_LITE_LANGUAGE_CODES.has(languageCode)) return undefined
  if (isQwenMtLiteModel(model) && languageCode === 'fa') return 'Persian'
  return QWEN_MT_TARGET_LANGUAGES[languageCode]
}

class CumulativeTextStreamListener implements StreamListener {
  readonly id: string
  private readonly previousTextById = new Map<string, string>()

  constructor(private readonly delegate: StreamListener) {
    this.id = delegate.id
  }

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string, attemptId?: number): void {
    if (chunk.type !== 'text-delta') {
      this.delegate.onChunk(chunk, sourceModelId, anchorMessageId, attemptId)
      return
    }

    const previousText = this.previousTextById.get(chunk.id) ?? ''
    const delta = chunk.delta.slice(previousText.length)
    this.previousTextById.set(chunk.id, chunk.delta)
    if (delta) this.delegate.onChunk({ ...chunk, delta }, sourceModelId, anchorMessageId, attemptId)
  }

  onDone(result: StreamDoneResult): void | Promise<void> {
    return this.delegate.onDone(result)
  }

  onPaused(result: StreamPausedResult): void | Promise<void> {
    return this.delegate.onPaused(result)
  }

  onError(result: StreamErrorResult): void | Promise<void> {
    return this.delegate.onError(result)
  }

  isAlive(): boolean {
    return this.delegate.isAlive()
  }
}

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
  const resolved = resolveSelection(normalizeRequestedSelection(effort, model), model)
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
  providerOptionsKey: string
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
    const { uniqueModelId, content, model, providerOptionsKey } = this.resolveTranslatePayload(req.text, targetLanguage)
    const { reasoningEffort, callOverrides } = this.resolveRequestParameters(model, targetLanguage, providerOptionsKey)

    const rendererListener = new WebContentsListener(sender, req.streamId)
    const listener = isQwenMtCumulativeModel(model)
      ? new CumulativeTextStreamListener(rendererListener)
      : rendererListener

    const streamManager = application.get('AiStreamManager')
    streamManager.streamPrompt({
      streamId: req.streamId,
      uniqueModelId,
      prompt: content,
      listener,
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
   * only `topK` (`filterStandardParams`), so temperature and topP reach the wire
   * as given and translate has to gate them here.
   *
   * That forces the gate to run before the pipeline resolves reasoning, which an
   * assistant's settings never do — `buildAgentParams` gates them after. Sharing
   * `normalizeRequestedSelection` + `resolveSelection` closes the model half of
   * that gap. What stays open is the endpoint: this reads the vocabulary
   * projected when the model row was materialized, while the pipeline
   * re-projects against the endpoint the request actually uses. #19693 is the
   * exit — it moves this gate inside the pipeline, where both are known.
   */
  resolveRequestParameters(
    model: Model,
    targetLanguage?: TranslateLanguage,
    providerOptionsKey = model.providerId
  ): { reasoningEffort: ReasoningEffortOption; callOverrides: CallOverrides } {
    const preferenceService = application.get('PreferenceService')
    const reasoningEffort = preferenceService.get('feature.translate.reasoning_effort')
    const settings = {
      temperature: preferenceService.get('feature.translate.temperature'),
      enableTemperature: preferenceService.get('feature.translate.enable_temperature'),
      topP: preferenceService.get('feature.translate.top_p'),
      enableTopP: preferenceService.get('feature.translate.enable_top_p')
    } satisfies GatedSampling

    const reasoning = { kind: reasoningKindFor(reasoningEffort, model) }
    const temperature = getTemperature(settings, model, reasoning)
    const topP = getTopP(settings, model, reasoning)
    let providerOptions: CallOverrides['providerOptions']
    if (targetLanguage && isQwenMTModel(model)) {
      const targetLang = resolveQwenMtTargetLanguage(targetLanguage, model)
      if (!targetLang) throw new Error(NOT_SUPPORTED_ERROR)
      providerOptions = {
        [providerOptionsKey]: {
          translation_options: { source_lang: 'auto', target_lang: targetLang },
          ...(isQwenMtIncrementalModel(model) && { incremental_output: true })
        }
      }
    }

    return {
      reasoningEffort,
      callOverrides: {
        ...(temperature !== undefined && { temperature }),
        ...(topP !== undefined && { topP }),
        ...(providerOptions && { providerOptions })
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
    const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
    const providerOptionsKey =
      matchesPreset(provider, SystemProviderIds.dashscope) &&
      resolvedEndpoint.endpointType !== ENDPOINT_TYPE.OPENAI_RESPONSES
        ? SystemProviderIds.dashscope
        : resolveEndpointProviderOptionsKey(provider, resolvedEndpoint)
    const content = isQwenMTModel(model)
      ? text
      : preferenceService
          .get('feature.translate.model_prompt')
          .replaceAll(/{{target_language}}|{{text}}/g, (placeholder) =>
            placeholder === '{{target_language}}' ? targetLanguage.value : text
          )

    return { uniqueModelId, content, model, providerOptionsKey }
  }
}

export const translateService = new TranslateService()
