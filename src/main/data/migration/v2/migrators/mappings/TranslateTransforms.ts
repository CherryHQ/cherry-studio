import type { TransformResult } from './ComplexPreferenceMappings'

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
    return {}
  }

  const [preferred, alter] = pair

  if (typeof preferred !== 'string' || typeof alter !== 'string') {
    return {}
  }

  return {
    'feature.translate.action.preferred_lang': preferred,
    'feature.translate.action.alter_lang': alter
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
    return {}
  }

  return {
    'feature.translate.mini_window.target_lang': lang
  }
}
