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
import { useCallback, useMemo } from 'react'
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
 */
const detectLanguageByLLM = async (inputText: string, langCodes: TranslateLangCode[]): Promise<TranslateLangCode> => {
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
 */
const detectLanguageByFranc = (inputText: string): TranslateLangCode => {
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

  return isoMap[iso3] ?? UNKNOWN.langCode
}

/**
 * Run detection with the given method and language candidate list.
 */
const detectWithMethod = async (
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
        return francResult === UNKNOWN.langCode ? detectLanguageByLLM(text, langCodes) : francResult
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

  const langCodes = useMemo(() => languages?.map((l: TranslateLanguageVo) => l.langCode) ?? [], [languages])

  const detectLanguage = useCallback(
    async (inputText: string): Promise<TranslateLangCode> => {
      const text = inputText.trim()
      if (!text) return UNKNOWN.langCode

      logger.info(`Auto detection method: ${method}`)
      const result = await detectWithMethod(text, method, langCodes)
      logger.info(`Detected language: ${result}`)
      return result.trim()
    },
    [method, langCodes]
  )

  return detectLanguage
}
