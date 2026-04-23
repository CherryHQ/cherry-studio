import { loggerService } from '@logger'
import { PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'

import type { TransformResult } from './ComplexPreferenceMappings'

const logger = loggerService.withContext('Migration:TranslateTransforms')

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
  const preferredResult = PersistedLangCodeSchema.safeParse(preferred.toLowerCase())
  const alterResult = PersistedLangCodeSchema.safeParse(alter.toLowerCase())

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
  const result = PersistedLangCodeSchema.safeParse(lang.toLowerCase())
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
