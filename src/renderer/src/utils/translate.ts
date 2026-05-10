import type { TranslateBidirectionalPair, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import type { RefObject } from 'react'
import React from 'react'

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

/**
 * 处理滚动同步
 * @param sourceElement 源元素
 * @param targetElement 目标元素
 * @param isProgrammaticScrollRef 是否程序控制滚动的引用
 */
export const handleScrollSync = (
  sourceElement: HTMLElement,
  targetElement: HTMLElement,
  isProgrammaticScrollRef: RefObject<boolean>
): void => {
  if (isProgrammaticScrollRef.current) return

  isProgrammaticScrollRef.current = true

  // 计算滚动位置比例
  const scrollRatio = sourceElement.scrollTop / (sourceElement.scrollHeight - sourceElement.clientHeight || 1)
  targetElement.scrollTop = scrollRatio * (targetElement.scrollHeight - targetElement.clientHeight || 1)

  requestAnimationFrame(() => {
    isProgrammaticScrollRef.current = false
  })
}

/**
 * 创建输入区域滚动处理函数
 */
export const createInputScrollHandler = (
  targetRef: RefObject<HTMLDivElement | null>,
  isProgrammaticScrollRef: RefObject<boolean>,
  isScrollSyncEnabled: boolean
) => {
  return (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!isScrollSyncEnabled || !targetRef.current || isProgrammaticScrollRef.current) return
    handleScrollSync(e.currentTarget, targetRef.current, isProgrammaticScrollRef)
  }
}

/**
 * 创建输出区域滚动处理函数
 */
export const createOutputScrollHandler = (
  textAreaRef: RefObject<any>,
  isProgrammaticScrollRef: RefObject<boolean>,
  isScrollSyncEnabled: boolean
) => {
  return (e: React.UIEvent<HTMLDivElement>) => {
    const current = textAreaRef.current
    const inputEl: HTMLTextAreaElement | null | undefined =
      current?.resizableTextArea?.textArea ?? (current instanceof HTMLTextAreaElement ? current : null)
    if (!isScrollSyncEnabled || !inputEl || isProgrammaticScrollRef.current) return
    handleScrollSync(e.currentTarget, inputEl, isProgrammaticScrollRef)
  }
}
