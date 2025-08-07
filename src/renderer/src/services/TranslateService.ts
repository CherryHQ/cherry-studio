import AiProvider from '@renderer/aiCore'
import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import {
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel
} from '@renderer/config/models'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { Language, TranslateAssistant } from '@renderer/types'

import { hasApiKey } from './ApiService'
import {
  getDefaultModel,
  getDefaultTranslateAssistant,
  getProviderByModel,
  getTranslateModel
} from './AssistantService'

interface FetchTranslateProps {
  content: string
  assistant: TranslateAssistant
  onResponse?: (text: string, isComplete: boolean) => void
}

async function fetchTranslate({ content, assistant, onResponse }: FetchTranslateProps) {
  const model = getTranslateModel() || assistant.model || getDefaultModel()

  if (!model) {
    throw new Error(i18n.t('error.provider_disabled'))
  }

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    throw new Error(i18n.t('error.no_api_key'))
  }

  const isSupportedStreamOutput = () => {
    if (!onResponse) {
      return false
    }
    return true
  }

  const stream = isSupportedStreamOutput()
  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const params: CompletionsParams = {
    callType: 'translate',
    messages: content,
    assistant: { ...assistant, model },
    streamOutput: stream,
    enableReasoning,
    onResponse
  }

  const AI = new AiProvider(provider)

  try {
    return (await AI.completions(params)).getText() || ''
  } catch (error: any) {
    return ''
  }
}

/**
 * 翻译文本到目标语言
 * @param text - 需要翻译的文本内容
 * @param targetLanguage - 目标语言
 * @param onResponse - 流式输出的回调函数，用于实时获取翻译结果
 * @returns 返回翻译后的文本
 * @throws {Error} 当翻译模型未配置或翻译失败时抛出错误
 */
export const translateText = async (
  text: string,
  targetLanguage: Language,
  onResponse?: (text: string, isComplete: boolean) => void
) => {
  const translateModel = store.getState().llm.translateModel

  if (!translateModel) {
    window.message.error({
      content: i18n.t('translate.error.not_configured'),
      key: 'translate-message'
    })
    return Promise.reject(new Error(i18n.t('translate.error.not_configured')))
  }

  const assistant = getDefaultTranslateAssistant(targetLanguage, text)

  const translatedText = await fetchTranslate({ content: text, assistant, onResponse })

  const trimmedText = translatedText.trim()

  if (!trimmedText) {
    return Promise.reject(new Error(i18n.t('translate.error.failed')))
  }

  return trimmedText
}
