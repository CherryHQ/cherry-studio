import { loggerService } from '@logger'
import { builtinLanguages as builtinLanguages, LanguagesEnum, UNKNOWN } from '@renderer/config/translate'
import { getAllCustomLanguages } from '@renderer/services/TranslateService'
import { TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { franc } from 'franc-min'
import React, { MutableRefObject, RefObject } from 'react'

const logger = loggerService.withContext('Utils:translate')

/**
 * 使用Unicode字符范围检测语言
 * 适用于较短文本的语言检测
 * @param text 需要检测语言的文本
 * @returns 检测到的语言
 */
export const detectLanguageByUnicode = (text: string): TranslateLanguage => {
  const counts = {
    zh: 0,
    ja: 0,
    ko: 0,
    ru: 0,
    ar: 0,
    latin: 0
  }

  let totalChars = 0

  for (const char of text) {
    const code = char.codePointAt(0) || 0
    totalChars++

    if (code >= 0x4e00 && code <= 0x9fff) {
      counts.zh++
    } else if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) {
      counts.ja++
    } else if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff)) {
      counts.ko++
    } else if (code >= 0x0400 && code <= 0x04ff) {
      counts.ru++
    } else if (code >= 0x0600 && code <= 0x06ff) {
      counts.ar++
    } else if ((code >= 0x0020 && code <= 0x007f) || (code >= 0x0080 && code <= 0x00ff)) {
      counts.latin++
    } else {
      totalChars--
    }
  }

  if (totalChars === 0) return LanguagesEnum.enUS
  let maxLang = ''
  let maxCount = 0

  for (const [lang, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count
      maxLang = lang === 'latin' ? 'en' : lang
    }
  }

  if (maxCount / totalChars < 0.3) {
    return LanguagesEnum.enUS
  }

  switch (maxLang) {
    case 'zh':
      return LanguagesEnum.zhCN
    case 'ja':
      return LanguagesEnum.jaJP
    case 'ko':
      return LanguagesEnum.koKR
    case 'ru':
      return LanguagesEnum.ruRU
    case 'ar':
      return LanguagesEnum.arAR
    case 'en':
      return LanguagesEnum.enUS
    default:
      logger.error(`Unknown language: ${maxLang}`)
      return LanguagesEnum.enUS
  }
}

/**
 * 检测输入文本的语言
 * @param inputText 需要检测语言的文本
 * @returns 检测到的语言
 */
export const detectLanguage = async (inputText: string): Promise<TranslateLanguage> => {
  const text = inputText.trim()
  if (!text) return LanguagesEnum.zhCN
  let lang: TranslateLanguage

  // 如果文本长度小于20个字符，使用Unicode范围检测
  if (text.length < 20) {
    lang = detectLanguageByUnicode(text)
  } else {
    // franc 返回 ISO 639-3 代码
    const iso3 = franc(text)
    const isoMap: Record<string, TranslateLanguage> = {
      cmn: LanguagesEnum.zhCN,
      jpn: LanguagesEnum.jaJP,
      kor: LanguagesEnum.koKR,
      rus: LanguagesEnum.ruRU,
      ara: LanguagesEnum.arAR,
      spa: LanguagesEnum.esES,
      fra: LanguagesEnum.frFR,
      deu: LanguagesEnum.deDE,
      ita: LanguagesEnum.itIT,
      por: LanguagesEnum.ptPT,
      eng: LanguagesEnum.enUS,
      pol: LanguagesEnum.plPL,
      tur: LanguagesEnum.trTR,
      tha: LanguagesEnum.thTH,
      vie: LanguagesEnum.viVN,
      ind: LanguagesEnum.idID,
      urd: LanguagesEnum.urPK,
      zsm: LanguagesEnum.msMY
    }
    lang = isoMap[iso3] || LanguagesEnum.enUS
  }

  return lang
}

/**
 * 获取双向翻译的目标语言
 * @param sourceLanguage 检测到的源语言
 * @param languagePair 配置的语言对
 * @returns 目标语言
 */
export const getTargetLanguageForBidirectional = (
  sourceLanguage: TranslateLanguage,
  languagePair: [TranslateLanguage, TranslateLanguage]
): TranslateLanguage => {
  if (sourceLanguage.langCode === languagePair[0].langCode) {
    return languagePair[1]
  } else if (sourceLanguage.langCode === languagePair[1].langCode) {
    return languagePair[0]
  }
  return languagePair[0] !== sourceLanguage ? languagePair[0] : languagePair[1]
}

/**
 * 检查源语言是否在配置的语言对中
 * @param sourceLanguage 检测到的源语言
 * @param languagePair 配置的语言对
 * @returns 是否在语言对中
 */
export const isLanguageInPair = (
  sourceLanguage: TranslateLanguage,
  languagePair: [TranslateLanguage, TranslateLanguage]
): boolean => {
  return [languagePair[0].langCode, languagePair[1].langCode].includes(sourceLanguage.langCode)
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
  sourceLanguage: TranslateLanguage,
  targetLanguage: TranslateLanguage,
  isBidirectional: boolean,
  bidirectionalPair: [TranslateLanguage, TranslateLanguage]
): { success: boolean; language?: TranslateLanguage; errorType?: 'same_language' | 'not_in_pair' } => {
  if (isBidirectional) {
    if (!isLanguageInPair(sourceLanguage, bidirectionalPair)) {
      return { success: false, errorType: 'not_in_pair' }
    }
    return {
      success: true,
      language: getTargetLanguageForBidirectional(sourceLanguage, bidirectionalPair)
    }
  } else {
    if (sourceLanguage.langCode === targetLanguage.langCode) {
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
  isProgrammaticScrollRef: MutableRefObject<boolean>
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
  textAreaRef: MutableRefObject<any>,
  isProgrammaticScrollRef: MutableRefObject<boolean>,
  isScrollSyncEnabled: boolean
) => {
  return (e: React.UIEvent<HTMLDivElement>) => {
    const inputEl = textAreaRef.current?.resizableTextArea?.textArea
    if (!isScrollSyncEnabled || !inputEl || isProgrammaticScrollRef.current) return
    handleScrollSync(e.currentTarget, inputEl, isProgrammaticScrollRef)
  }
}

/**
 * 根据语言代码获取对应的语言对象
 * @deprecated
 * @param langcode - 语言代码
 * @returns 返回对应的语言对象，如果找不到则返回未知语言
 * @example
 * ```typescript
 * const language = getLanguageByLangcode('zh-cn') // 返回中文语言对象
 * ```
 */
export const getLanguageByLangcode = (langcode: TranslateLanguageCode): TranslateLanguage => {
  const result = Object.values(LanguagesEnum).find((item) => item.langCode === langcode)
  if (!result) {
    logger.error(`Language not found for langcode: ${langcode}`)
    return UNKNOWN
  }
  return result
}

/**
 * 获取所有可用的翻译语言选项。如果获取自定义语言失败，将只返回内置语言选项。
 * @returns 返回内置语言选项和自定义语言选项的组合数组
 */
export const getTranslateOptions = async () => {
  try {
    const customLanguages = await getAllCustomLanguages()
    // 转换为Language类型
    const transformedCustomLangs: TranslateLanguage[] = customLanguages.map((item) => ({
      value: item.value,
      label: () => item.value,
      emoji: item.emoji,
      langCode: item.langCode
    }))
    return [...builtinLanguages, ...transformedCustomLangs]
  } catch (e) {
    return builtinLanguages
  }
}
