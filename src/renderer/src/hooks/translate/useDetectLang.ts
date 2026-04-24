import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { isQwenMTModel } from '@renderer/config/models'
import { UNKNOWN } from '@renderer/config/translate'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getQuickModel } from '@renderer/services/AssistantService'
import { hasModel } from '@renderer/services/ModelService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { TranslateLanguageVo } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { LANG_DETECT_PROMPT } from '@shared/config/prompts'
import {
  type AutoDetectionMethod,
  isTranslateLangCode,
  type TranslateLangCode
} from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translate-languages'
import { franc } from 'franc-min'
import i18n from 'i18next'
import { useCallback, useRef } from 'react'
import { sliceByTokens } from 'tokenx'

import { useLanguages } from './useLanguages'

const logger = loggerService.withContext('translate/useDetectLang')

/** Max tokens to slice from input text for LLM detection. */
const LLM_INPUT_MAX_TOKENS = 100

/**
 * Token threshold for 'auto' mode: texts shorter than this prefer LLM,
 * longer texts try franc first and fall back to LLM on failure.
 */
const AUTO_MODE_LLM_THRESHOLD = 100

// ---------------------------------------------------------------------------
// Pure helpers (no React dependency)
// ---------------------------------------------------------------------------

/**
 * Detect language using an LLM with the provided language list as candidates.
 *
 * @internal Exported for unit tests alongside the other pure helpers.
 */
export const detectLanguageByLLM = async (
  inputText: string,
  langCodes: TranslateLangCode[]
): Promise<TranslateLangCode> => {
  logger.info('Detect language by LLM')
  let detectedLang: string = ''
  const text = sliceByTokens(inputText, 0, LLM_INPUT_MAX_TOKENS)
  const listLangText = JSON.stringify(langCodes)

  const model = getQuickModel()
  if (!model || !hasModel(model)) {
    throw new Error(i18n.t('error.model.not_exists'))
  }

  if (isQwenMTModel(model)) {
    throw new Error(i18n.t('translate.error.detect.qwen_mt'))
  }

  const assistant = getDefaultAssistant()
  assistant.model = model
  assistant.settings = { reasoning_effort: 'none' }
  assistant.prompt = LANG_DETECT_PROMPT.replace('{{list_lang}}', listLangText).replace('{{input}}', text)

  const onChunk = (chunk: Chunk) => {
    if (chunk.type === ChunkType.TEXT_DELTA) {
      detectedLang = chunk.text
    } else if (chunk.type === ChunkType.ERROR) {
      // Surface upstream LLM errors instead of letting the caller mistake them
      // for an empty-response / invalid-langcode result further down.
      throw new Error(i18n.t('translate.error.detect.failed'))
    }
  }

  await fetchChatCompletion({ prompt: 'follow system prompt', assistant, onChunkReceived: onChunk })

  const trimmed = detectedLang.trim()
  if (!trimmed) {
    throw new Error(i18n.t('translate.error.detect.empty'))
  }

  if (!isTranslateLangCode(trimmed)) {
    logger.error(`Invalid language code: ${trimmed}`)
    throw new Error(i18n.t('translate.error.detect.invalid'))
  }

  return trimmed
}

/**
 * Detect language using the franc library (offline, fast).
 *
 * @internal Exported for unit tests alongside the other pure helpers.
 */
export const detectLanguageByFranc = (inputText: string): TranslateLangCode => {
  logger.info('Detect language by franc')
  const iso3 = franc(inputText)

  const isoMap: Record<string, TranslateLangCode> = {
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

  const mapped = isoMap[iso3]
  if (mapped === undefined) {
    // franc recognized a language but we have no mapping for it yet. Log so
    // we can discover cold languages that real users speak.
    logger.debug('franc iso3 not in isoMap, falling back to UNKNOWN', { iso3 })
    return UNKNOWN.langCode
  }
  return mapped
}

/**
 * Run detection with the given method and language candidate list.
 *
 * @internal Exported for unit tests alongside the other pure helpers.
 */
export const detectWithMethod = async (
  text: string,
  method: AutoDetectionMethod,
  langCodes: TranslateLangCode[]
): Promise<TranslateLangCode> => {
  switch (method) {
    case 'auto':
      if (estimateTextTokens(text) < AUTO_MODE_LLM_THRESHOLD) {
        return detectLanguageByLLM(text, langCodes)
      } else {
        const francResult = detectLanguageByFranc(text)
        if (francResult === UNKNOWN.langCode) {
          // Auto mode's contract is "pick what works"; we fall back silently from
          // the user's perspective but log so `auto` → LLM quota bursts are traceable.
          logger.info('franc returned UNKNOWN, falling back to LLM detection')
          return detectLanguageByLLM(text, langCodes)
        }
        return francResult
      }
    case 'franc':
      return detectLanguageByFranc(text)
    case 'llm':
      return detectLanguageByLLM(text, langCodes)
    default:
      throw new Error('Invalid detection method.')
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that returns a stable `detectLanguage` callback.
 *
 * The detection method (`auto` / `franc` / `llm`) is read from the
 * `feature.translate.auto_detection_method` preference via {@link usePreference},
 * and the candidate language list comes from {@link useLanguages},
 * so both stay in sync with user settings without prop-drilling.
 *
 * @returns `detectLanguage(text: string) => Promise<TranslateLangCode>`
 */
export const useDetectLang = () => {
  const [method] = usePreference('feature.translate.auto_detection_method')
  const { languages } = useLanguages()

  // One-shot UX surface: useLanguages only toasts on SWR error, but a successful
  // empty-array response (seeder failure / DB corruption) slips past it. Notify
  // the user once per session so they don't silently keep getting UNKNOWN.
  const toastedEmptyRef = useRef(false)

  const detectLanguage = useCallback(
    async (inputText: string): Promise<TranslateLangCode> => {
      const text = inputText.trim()
      if (!text) return UNKNOWN.langCode

      // Not ready: SWR hasn't resolved yet. Rare (the hook is normally called
      // from click handlers) but possible on very fast user input; degrade
      // to UNKNOWN silently so UX doesn't crash.
      if (languages === undefined) {
        logger.warn('useDetectLang invoked before languages were ready, returning UNKNOWN')
        return UNKNOWN.langCode
      }

      // No data: endpoint resolved with an empty list. Seeder failure or DB
      // corruption — log loudly for Sentry and surface a one-shot toast so
      // the user knows why every translation is coming back as UNKNOWN.
      if (languages.length === 0) {
        logger.error('useDetectLang invoked with an empty language list')
        if (!toastedEmptyRef.current) {
          toastedEmptyRef.current = true
          window.toast?.error(i18n.t('translate.error.languages_load_failed'))
        }
        return UNKNOWN.langCode
      }

      const langCodes = languages.map((l: TranslateLanguageVo) => l.langCode)
      logger.info(`Auto detection method: ${method}`)
      const result = await detectWithMethod(text, method, langCodes)
      logger.info(`Detected language: ${result}`)
      return result.trim()
    },
    [method, languages]
  )

  return detectLanguage
}
