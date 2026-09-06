/**
 * Source-language detection, main side.
 *
 * Lives here rather than in the renderer because it is the first step of a translation and the
 * flow that owns it must survive a window detach, which destroys and rebuilds the renderer. A
 * detection whose promise lives in that renderer is lost with it, and so is the orchestration
 * around it — see `docs/superpowers/specs/2026-09-06-translate-flow-in-main-design.md`.
 *
 * Both entry points degrade to UNKNOWN rather than fail, so nothing here reaches a user: the
 * messages below are log identifiers, not i18n keys anyone resolves. A detection that cannot
 * answer is not a translation that cannot run.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { translateLanguageService } from '@main/data/services/TranslateLanguageService'
import { LANG_DETECT_PROMPT } from '@shared/ai/prompts'
import {
  type AutoDetectionMethod,
  isTranslateLangCode,
  type TranslateLangCode
} from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { isQwenMTModel } from '@shared/utils/model'
import { UNKNOWN_LANG_CODE } from '@shared/utils/translateLanguage'
import { franc } from 'franc-min'
import { estimateTokenCount, sliceByTokens } from 'tokenx'

const logger = loggerService.withContext('translate/detectLanguage')

/** Max tokens to slice from input text for LLM detection. */
const LLM_INPUT_MAX_TOKENS = 100

/**
 * Token threshold for 'auto' mode: texts shorter than this prefer LLM,
 * longer texts try franc first and fall back to LLM on failure.
 */
const AUTO_MODE_LLM_THRESHOLD = 100

async function detectLanguageByLLM(
  inputText: string,
  langCodes: TranslateLangCode[],
  model: Model | undefined,
  signal: AbortSignal | undefined
): Promise<TranslateLangCode> {
  logger.info('Detect language by LLM')
  const text = sliceByTokens(inputText, 0, LLM_INPUT_MAX_TOKENS)
  const listLangText = JSON.stringify(langCodes)

  if (!model) {
    throw new Error('error.model.not_exists')
  }

  if (isQwenMTModel(model)) {
    throw new Error('translate.error.detect.qwen_mt')
  }

  const systemPrompt = LANG_DETECT_PROMPT.replaceAll(/{{list_lang}}|{{input}}/g, (placeholder) =>
    placeholder === '{{list_lang}}' ? listLangText : text
  )

  const { text: result } = await application.get('AiService').generateText({
    uniqueModelId: model.id,
    reasoningEffort: 'none',
    system: systemPrompt,
    prompt: 'follow system prompt',
    requestOptions: signal ? { signal } : undefined
  })

  const trimmed = result.trim()
  if (!trimmed) {
    throw new Error('translate.error.detect.empty')
  }

  if (!isTranslateLangCode(trimmed)) {
    logger.error(`Invalid language code: ${trimmed}`)
    throw new Error('translate.error.detect.invalid')
  }

  return trimmed
}

/** franc's iso3 output, for the languages we can name. */
const ISO3_TO_LANG_CODE: Record<string, TranslateLangCode> = {
  cmn: BUILTIN_LANGUAGE.zhCN.langCode,
  jpn: BUILTIN_LANGUAGE.jaJP.langCode,
  kor: BUILTIN_LANGUAGE.koKR.langCode,
  rus: BUILTIN_LANGUAGE.ruRU.langCode,
  ara: BUILTIN_LANGUAGE.arSA.langCode,
  spa: BUILTIN_LANGUAGE.esES.langCode,
  fra: BUILTIN_LANGUAGE.frFR.langCode,
  deu: BUILTIN_LANGUAGE.deDE.langCode,
  ita: BUILTIN_LANGUAGE.itIT.langCode,
  por: BUILTIN_LANGUAGE.ptPT.langCode,
  eng: BUILTIN_LANGUAGE.enUS.langCode,
  pol: BUILTIN_LANGUAGE.plPL.langCode,
  tur: BUILTIN_LANGUAGE.trTR.langCode,
  tha: BUILTIN_LANGUAGE.thTH.langCode,
  vie: BUILTIN_LANGUAGE.viVN.langCode,
  ind: BUILTIN_LANGUAGE.idID.langCode,
  urd: BUILTIN_LANGUAGE.urPK.langCode,
  zsm: BUILTIN_LANGUAGE.msMY.langCode
}

/** Detect language using the franc library (offline, fast). */
function detectLanguageByFranc(inputText: string): TranslateLangCode {
  logger.info('Detect language by franc')
  const iso3 = franc(inputText)

  const mapped = ISO3_TO_LANG_CODE[iso3]
  if (mapped === undefined) {
    // franc recognized a language but we have no mapping for it yet. Log so
    // we can discover cold languages that real users speak.
    logger.debug('franc iso3 has no lang code mapping, falling back to UNKNOWN', { iso3 })
    return UNKNOWN_LANG_CODE
  }
  return mapped
}

async function detectWithMethod(
  text: string,
  method: AutoDetectionMethod,
  langCodes: TranslateLangCode[],
  model: Model | undefined,
  signal: AbortSignal | undefined
): Promise<TranslateLangCode> {
  switch (method) {
    case 'auto':
      if (estimateTokenCount(text) < AUTO_MODE_LLM_THRESHOLD) {
        return detectLanguageByLLM(text, langCodes, model, signal)
      } else {
        const francResult = detectLanguageByFranc(text)
        if (francResult === UNKNOWN_LANG_CODE) {
          // Auto mode's contract is "pick what works"; we fall back silently from
          // the user's perspective but log so `auto` → LLM quota bursts are traceable.
          logger.info('franc returned UNKNOWN, falling back to LLM detection')
          return detectLanguageByLLM(text, langCodes, model, signal)
        }
        return francResult
      }
    case 'franc':
      return detectLanguageByFranc(text)
    case 'llm':
      return detectLanguageByLLM(text, langCodes, model, signal)
    default:
      throw new Error('Invalid detection method.')
  }
}

/** The model detection runs on: the quick-assistant model, falling back to the default one. */
function resolveDetectionModel(): Model | undefined {
  const preferenceService = application.get('PreferenceService')
  const modelIdRaw =
    preferenceService.get('feature.quick_assistant.model_id') ?? preferenceService.get('chat.default_model_id')
  if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) return undefined

  const { providerId, modelId } = parseUniqueModelId(modelIdRaw)
  try {
    return modelService.getByKey(providerId, modelId)
  } catch {
    return undefined
  }
}

/**
 * Detect `inputText`'s language, with the method from `feature.translate.auto_detection_method`.
 *
 * @param signal aborts the LLM request the detection may make. Not reachable over IPC: the
 *   orchestration that can cancel a detection is the one that started it, and that lives in main.
 * @throws with a bare `translate.error.*` key when the chosen method cannot answer — an
 *   unreachable model, an unusable reply, or a language list that arrived empty. Callers that
 *   would rather degrade than fail want {@link detectLanguageOrUnknown}.
 */
async function detectLanguage(inputText: string, signal?: AbortSignal): Promise<TranslateLangCode> {
  const text = inputText.trim()
  if (!text) return UNKNOWN_LANG_CODE

  const languages = translateLanguageService.list()
  if (languages.length === 0) {
    // Loaded fine and came back empty — a seeder failure or a damaged database, which is a
    // different thing from the load failing. Either way there is nothing to detect against.
    logger.error('Language detection ran against an empty language list')
    throw new Error('translate.error.detect.no_languages')
  }

  const method = application.get('PreferenceService').get('feature.translate.auto_detection_method')
  logger.info(`Auto detection method: ${method}`)
  const result = await detectWithMethod(
    text,
    method,
    languages.map((language) => language.langCode),
    resolveDetectionModel(),
    signal
  )
  logger.info(`Detected language: ${result}`)
  return result
}

/** {@link detectLanguage}, degrading to UNKNOWN rather than throwing. */
export async function detectLanguageOrUnknown(text: string, signal?: AbortSignal): Promise<TranslateLangCode> {
  try {
    return await detectLanguage(text, signal)
  } catch (error) {
    // An abort is the caller's own doing, not a detection that failed.
    if (!signal?.aborted) logger.warn('Language detection failed, falling back to unknown', { error })
    return UNKNOWN_LANG_CODE
  }
}
