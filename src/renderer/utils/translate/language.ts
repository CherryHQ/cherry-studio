import type { TranslateBidirectionalPair, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'

export const UNKNOWN_LANG_CODE = 'unknown' satisfies TranslateLangCode

export const pickBidirectionalTarget = (
  sourceLanguageCode: TranslateLangCode,
  preferred: TranslateLanguage,
  alter: TranslateLanguage,
  overrideTarget?: TranslateLanguage
): TranslateLanguage => {
  if (overrideTarget) {
    return overrideTarget
  }
  if (sourceLanguageCode === UNKNOWN_LANG_CODE) {
    return preferred
  }
  return sourceLanguageCode === preferred.langCode ? alter : preferred
}

export const shouldPersistDirectTarget = (
  target: TranslateLanguage,
  preferred: TranslateLanguage,
  alter: TranslateLanguage
): boolean => {
  return target.langCode !== preferred.langCode && target.langCode !== alter.langCode
}

/**
 * 获取双向翻译的目标语言
 *
 * Invariant: `sourceLanguage` must be one of the two entries in `languagePair`.
 * {@link determineTargetLanguage} is the only caller and guards this with
 * `isLanguageInPair` before invoking us; anything else would be a programming
 * error, so we throw instead of silently returning a guessed value.
 *
 * @param sourceLanguage 检测到的源语言
 * @param languagePair 配置的语言对
 * @returns 目标语言
 */
export const getTargetLanguageForBidirectional = (
  sourceLanguage: TranslateLangCode,
  languagePair: TranslateBidirectionalPair
): TranslateLangCode => {
  if (sourceLanguage === languagePair[0]) return languagePair[1]
  if (sourceLanguage === languagePair[1]) return languagePair[0]
  throw new Error(
    `Unreachable: sourceLanguage '${sourceLanguage}' is not in pair [${languagePair[0]}, ${languagePair[1]}]`
  )
}

/**
 * 检查源语言是否在配置的语言对中
 * @param sourceLanguage 检测到的源语言
 * @param languagePair 配置的语言对
 * @returns 是否在语言对中
 */
const isLanguageInPair = (sourceLanguage: TranslateLangCode, languagePair: TranslateBidirectionalPair): boolean => {
  return [languagePair[0], languagePair[1]].includes(sourceLanguage)
}

/**
 * 确定翻译的目标语言
 * @param sourceLanguage 检测到的源语言
 * @param targetLanguage 用户设置的目标语言
 * @param isBidirectional 是否开启双向翻译
 * @param bidirectionalPair 双向翻译的语言对
 * @returns 处理结果对象
 */
export const determineTargetLanguage = (
  sourceLanguage: TranslateLangCode,
  targetLanguage: TranslateLangCode,
  isBidirectional: boolean,
  bidirectionalPair: TranslateBidirectionalPair
): { success: true; language: TranslateLangCode } | { success: false; errorType: 'same_language' | 'not_in_pair' } => {
  if (isBidirectional) {
    if (!isLanguageInPair(sourceLanguage, bidirectionalPair)) {
      return { success: false, errorType: 'not_in_pair' }
    }
    return {
      success: true,
      language: getTargetLanguageForBidirectional(sourceLanguage, bidirectionalPair)
    }
  } else {
    if (sourceLanguage === targetLanguage) {
      return { success: false, errorType: 'same_language' }
    }
    return { success: true, language: targetLanguage }
  }
}
