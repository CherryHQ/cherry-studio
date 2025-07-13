import { LanguagesEnum, languagesWithUNK, UNKNOWN } from '@renderer/config/translate'
import db from '@renderer/databases'
import { fetchLanguageDetection } from '@renderer/services/ApiService'
import { Language, LanguageCode } from '@renderer/types'
import { franc } from 'franc-min'
import React, { MutableRefObject } from 'react'

export type AutoDetectMethod = 'franc' | 'llm' | 'auto'

/**
 * 检测输入文本的语言
 * @param inputText 需要检测语言的文本
 * @returns 检测到的语言
 */
export const detectLanguage = async (inputText: string): Promise<Language> => {
  const text = inputText.trim()
  if (!text) return LanguagesEnum.zhCN

  let method = (await db.settings.get({ id: 'translate:detect:method' }))?.value
  if (!method) method = 'auto'

  switch (method) {
    case 'auto':
      return text.length < 50 ? await detectLanguageByLLM(text) : detectLanguageByFranc(text)
    case 'franc':
      return detectLanguageByFranc(text)
    case 'llm':
      return await detectLanguageByLLM(text)
    default:
      throw new Error('Invalid detect method.')
  }
}

const detectLanguageByLLM = async (inputText: string): Promise<Language> => {
  let detectedLang = ''
  await fetchLanguageDetection({
    text: inputText.slice(0, 50),
    onResponse: (text) => {
      detectedLang = text.replace(/^\s*\n+/g, '')
    }
  })
  return getLanguageByLangcode(detectedLang as LanguageCode)
}

const detectLanguageByFranc = (inputText: string): Language => {
  const iso3 = franc(inputText)

  const isoMap: Record<string, Language> = {
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

  return isoMap[iso3] || UNKNOWN
}

/**
 * 获取双向翻译的目标语言
 * @param sourceLanguage 检测到的源语言
 * @param languagePair 配置的语言对
 * @returns 目标语言
 */
export const getTargetLanguageForBidirectional = (
  sourceLanguage: Language,
  languagePair: [Language, Language]
): Language => {
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
export const isLanguageInPair = (sourceLanguage: Language, languagePair: [Language, Language]): boolean => {
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
  sourceLanguage: Language,
  targetLanguage: Language,
  isBidirectional: boolean,
  bidirectionalPair: [Language, Language]
): { success: boolean; language?: Language; errorType?: 'same_language' | 'not_in_pair' } => {
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
  targetRef: MutableRefObject<HTMLDivElement | null>,
  isProgrammaticScrollRef: MutableRefObject<boolean>,
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
 * @param langcode - 语言代码
 * @returns 返回对应的语言对象，如果找不到则返回英语(enUS)
 * @example
 * ```typescript
 * const language = getLanguageByLangcode('zh-cn') // 返回中文语言对象
 * ```
 */
export const getLanguageByLangcode = (langcode: LanguageCode): Language => {
  const result = languagesWithUNK.find((item) => item.langCode === langcode)
  if (!result) {
    console.error(`Language not found for langcode: ${langcode}`)
    return LanguagesEnum.enUS
  }
  return result
}
