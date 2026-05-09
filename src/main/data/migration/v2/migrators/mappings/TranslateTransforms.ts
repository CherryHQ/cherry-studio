import { loggerService } from '@logger'
import { PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'

import type { TransformResult } from './ComplexPreferenceMappings'

const logger = loggerService.withContext('Migration:TranslateTransforms')
const LEGACY_LANG_CODE_MAP: Record<string, string> = {
  'ar-ar': 'ar-sa'
}

const canonicalizeLegacyLangCode = (langCode: string): string => {
  return LEGACY_LANG_CODE_MAP[langCode] ?? langCode
}

const parseLegacyPersistedLangCode = (langCode: string) => {
  return PersistedLangCodeSchema.safeParse(canonicalizeLegacyLangCode(langCode.toLowerCase()))
}

/**
 * Split the legacy `translate:bidirectional:pair` tuple into separate
 * action-translate preference keys.
 *
 * Old Dexie value: `[langCode1, langCode2]` (a two-element array)
 * → `feature.translate.action.preferred_lang` = pair[0]
 * → `feature.translate.action.alter_lang`     = pair[1]
 */
export function splitBidirectionalPairForAction(sources: { bidirectionalPair?: unknown }): TransformResult {
  const pair = sources.bidirectionalPair

  if (!Array.isArray(pair) || pair.length < 2) {
    logger.error('Invalid bidirectional pair: expected array with >= 2 elements, falling back to defaults', {
      value: pair
    })
    return {}
  }

  const [preferred, alter] = pair

  if (typeof preferred !== 'string' || typeof alter !== 'string') {
    logger.error('Invalid bidirectional pair: expected string elements, falling back to defaults', { preferred, alter })
    return {}
  }

  // Normalize to lowercase and parse through the strict schema so values like
  // "Auto" / "EN" / "zh_CN" don't get written verbatim into the new preference —
  // they'd type-check as `string` but fail the TranslateLangCode regex at the
  // point of consumption, producing confusing runtime issues later.
  const preferredResult = parseLegacyPersistedLangCode(preferred)
  const alterResult = parseLegacyPersistedLangCode(alter)

  if (!preferredResult.success || !alterResult.success) {
    logger.error(
      'Invalid bidirectional pair: langCodes did not match TranslateLangCode pattern, falling back to defaults',
      { preferred, alter }
    )
    return {}
  }

  return {
    'feature.translate.action.preferred_lang': preferredResult.data,
    'feature.translate.action.alter_lang': alterResult.data
  }
}

/**
 * Copy the legacy `translate:target:language` value to the mini-window
 * target language preference.
 *
 * Old Dexie value: a language code string (e.g. "en-us")
 * → `feature.translate.mini_window.target_lang`
 */
export function copyTargetLanguageForMiniWindow(sources: { targetLanguage?: unknown }): TransformResult {
  const lang = sources.targetLanguage

  if (typeof lang !== 'string' || lang.length === 0) {
    logger.error('Invalid target language: expected non-empty string, falling back to defaults', { value: lang })
    return {}
  }

  // Same normalization as the bidirectional pair — block malformed legacy values
  // from reaching the new preference store.
  const result = parseLegacyPersistedLangCode(lang)
  if (!result.success) {
    logger.error('Invalid target language: did not match TranslateLangCode pattern, falling back to defaults', {
      value: lang
    })
    return {}
  }

  return {
    'feature.translate.mini_window.target_lang': result.data
  }
}

export function copyTranslatePageLanguages(sources: {
  bidirectionalPair?: unknown
  sourceLanguage?: unknown
  targetLanguage?: unknown
}): TransformResult {
  return {
    ...copyTranslatePageBidirectionalPair(sources.bidirectionalPair),
    ...copyTranslatePageSourceLanguage(sources.sourceLanguage),
    ...copyTranslatePageTargetLanguage(sources.targetLanguage)
  }
}

function copyTranslatePageBidirectionalPair(bidirectionalPair: unknown): TransformResult {
  const pair = bidirectionalPair

  if (pair === undefined) {
    return {}
  }

  if (!Array.isArray(pair) || pair.length < 2) {
    logger.error('Invalid translate page bidirectional pair: expected array with >= 2 elements', { value: pair })
    return {}
  }

  const [source, target] = pair

  if (typeof source !== 'string' || typeof target !== 'string') {
    logger.error('Invalid translate page bidirectional pair: expected string elements', { source, target })
    return {}
  }

  const sourceResult = parseLegacyPersistedLangCode(source)
  const targetResult = parseLegacyPersistedLangCode(target)

  if (!sourceResult.success || !targetResult.success) {
    logger.error('Invalid translate page bidirectional pair: langCodes did not match persisted pattern', {
      source,
      target
    })
    return {}
  }

  return {
    'feature.translate.page.bidirectional_pair': [sourceResult.data, targetResult.data]
  }
}

function copyTranslatePageSourceLanguage(lang: unknown): TransformResult {
  if (lang === undefined) {
    return {}
  }

  if (lang === 'auto') {
    return {
      'feature.translate.page.source_language': 'auto'
    }
  }

  if (typeof lang !== 'string' || lang.length === 0) {
    logger.error('Invalid translate page source language: expected non-empty string', { value: lang })
    return {}
  }

  const result = parseLegacyPersistedLangCode(lang)
  if (!result.success) {
    logger.error('Invalid translate page source language: did not match persisted pattern', { value: lang })
    return {}
  }

  return {
    'feature.translate.page.source_language': result.data
  }
}

function copyTranslatePageTargetLanguage(lang: unknown): TransformResult {
  if (lang === undefined) {
    return {}
  }

  if (typeof lang !== 'string' || lang.length === 0) {
    logger.error('Invalid translate page target language: expected non-empty string', { value: lang })
    return {}
  }

  const result = parseLegacyPersistedLangCode(lang)
  if (!result.success) {
    logger.error('Invalid translate page target language: did not match persisted pattern', { value: lang })
    return {}
  }

  return {
    'feature.translate.page.target_language': result.data
  }
}
