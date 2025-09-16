import { loggerService } from '@logger'
import { isQwenMTModel } from '@renderer/config/models'
import { LANG_DETECT_PROMPT } from '@renderer/config/prompts'
import { builtinLanguages, LanguagesEnum, UNKNOWN } from '@renderer/config/translate'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultAssistant, getDefaultModel, getQuickModel } from '@renderer/services/AssistantService'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { getAllCustomLanguages } from '@renderer/services/TranslateService'
import { Assistant, TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { franc } from 'franc-min'
import React, { RefObject } from 'react'
import { sliceByTokens } from 'tokenx'

const logger = loggerService.withContext('Utils:translate')

/**
 * 检测输入文本的语言
 * @param inputText 需要检测语言的文本
 * @returns 检测到的语言
 * @throws {Error}
 */
export const detectLanguage = async (inputText: string): Promise<TranslateLanguageCode> => {
  const text = inputText.trim()
  if (!text) return LanguagesEnum.zhCN.langCode

  let method = (await db.settings.get({ id: 'translate:detect:method' }))?.value
  if (!method) method = 'auto'
  logger.info(`auto detection method: ${method}`)

  let result: TranslateLanguageCode
  switch (method) {
    case 'auto':
      // hard encoded threshold
      if (estimateTextTokens(text) < 100) {
        result = await detectLanguageByLLM(text)
      } else {
        result = detectLanguageByFranc(text)
        // fallback to llm when franc fails
        if (result === UNKNOWN.langCode) {
          result = await detectLanguageByLLM(text)
        }
      }
      break
    case 'franc':
      result = detectLanguageByFranc(text)
      break
    case 'llm':
      result = await detectLanguageByLLM(text)
      break
    default:
      throw new Error('Invalid detection method.')
  }
  logger.info(`Detected Language: ${result}`)
  return result.trim()
}

const detectLanguageByLLM = async (inputText: string): Promise<TranslateLanguageCode> => {
  logger.info('Detect language by llm')
  let detectedLang = ''
  const text = sliceByTokens(inputText, 0, 100)

  const translateLanguageOptions = await getTranslateOptions()
  const listLang = translateLanguageOptions.map((item) => item.langCode)
  const listLangText = JSON.stringify(listLang)

  const model = getQuickModel() || getDefaultModel()
  if (!model) {
    throw new Error(i18n.t('error.model.not_exists'))
  }

  if (isQwenMTModel(model)) {
    logger.info('QwenMT cannot be used for language detection.')
    if (isQwenMTModel(model)) {
      throw new Error(i18n.t('translate.error.detect.qwen_mt'))
    }
  }

  const assistant: Assistant = getDefaultAssistant()

  assistant.model = model
  assistant.settings = {
    temperature: 0.7
  }
  assistant.prompt = LANG_DETECT_PROMPT.replace('{{list_lang}}', listLangText).replace('{{input}}', text)

  const onChunk: (chunk: Chunk) => void = (chunk: Chunk) => {
    // 你的意思是，虽然写的是delta类型，但其实是完整拼接后的结果？
    if (chunk.type === ChunkType.TEXT_DELTA) {
      detectedLang = chunk.text
    }
  }

  await fetchChatCompletion({ prompt: 'follow system prompt', assistant, onChunkReceived: onChunk })
  return detectedLang.trim()
}

const detectLanguageByFranc = (inputText: string): TranslateLanguageCode => {
  logger.info('Detect language by franc')
  const iso3 = franc(inputText)

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

  return isoMap[iso3]?.langCode ?? UNKNOWN.langCode
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
    const inputEl = textAreaRef.current?.resizableTextArea?.textArea
    if (!isScrollSyncEnabled || !inputEl || isProgrammaticScrollRef.current) return
    handleScrollSync(e.currentTarget, inputEl, isProgrammaticScrollRef)
  }
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
