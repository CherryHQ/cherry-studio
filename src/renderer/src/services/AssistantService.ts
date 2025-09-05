import { loggerService } from '@logger'
import {
  DEFAULT_CONTEXTCOUNT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_CONTEXT_COUNT,
  UNLIMITED_CONTEXT_COUNT
} from '@renderer/config/constant'
import { isQwenMTModel } from '@renderer/config/models'
import {
  AI_COMPLETE_PROMPT,
  AI_FIX_SPELLING_PROMPT,
  AI_GENERATE_PROMPT,
  AI_IMPROVE_PROMPT,
  AI_SUMMARIZE_PROMPT
} from '@renderer/config/prompts'
import { UNKNOWN } from '@renderer/config/translate'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type {
  Agent,
  Assistant,
  AssistantSettings,
  Model,
  Provider,
  Topic,
  TranslateAssistant,
  TranslateLanguage
} from '@renderer/types'
import { uuid } from '@renderer/utils'

const logger = loggerService.withContext('AssistantService')

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  temperature: DEFAULT_TEMPERATURE,
  enableTemperature: true,
  contextCount: DEFAULT_CONTEXTCOUNT,
  enableMaxTokens: false,
  maxTokens: 0,
  streamOutput: true,
  topP: 1,
  enableTopP: true,
  toolUseMode: 'prompt',
  customParameters: []
}

export function getDefaultAssistant(): Assistant {
  return {
    id: 'default',
    name: i18n.t('chat.default.name'),
    emoji: '😀',
    prompt: '',
    topics: [getDefaultTopic('default')],
    messages: [],
    type: 'assistant',
    regularPhrases: [], // Added regularPhrases
    settings: DEFAULT_ASSISTANT_SETTINGS
  }
}

export function getDefaultTranslateAssistant(targetLanguage: TranslateLanguage, text: string): TranslateAssistant {
  const model = getTranslateModel()
  const assistant: Assistant = getDefaultAssistant()

  if (!model) {
    logger.error('No translate model')
    throw new Error(i18n.t('translate.error.not_configured'))
  }

  if (targetLanguage.langCode === UNKNOWN.langCode) {
    logger.error('Unknown target language', targetLanguage)
    throw new Error('Unknown target language')
  }

  const settings = {
    temperature: 0.7
  }

  let prompt: string
  let content: string
  if (isQwenMTModel(model)) {
    content = text
    prompt = ''
  } else {
    content = 'follow system instruction'
    prompt = store
      .getState()
      .settings.translateModelPrompt.replaceAll('{{target_language}}', targetLanguage.value)
      .replaceAll('{{text}}', text)
  }

  const translateAssistant = {
    ...assistant,
    model,
    settings,
    prompt,
    targetLanguage,
    content
  } satisfies TranslateAssistant
  return translateAssistant
}

export function getDefaultAssistantSettings() {
  return store.getState().assistants.defaultAssistant.settings
}

export function getDefaultTopic(assistantId: string): Topic {
  return {
    id: uuid(),
    assistantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: i18n.t('chat.default.topic.name'),
    messages: [],
    isNameManuallyEdited: false
  }
}

export function getDefaultProvider() {
  return getProviderByModel(getDefaultModel())
}

export function getDefaultModel() {
  return store.getState().llm.defaultModel
}

export function getQuickModel() {
  return store.getState().llm.quickModel
}

export function getTranslateModel() {
  return store.getState().llm.translateModel
}

export function getAssistantProvider(assistant: Assistant): Provider {
  const providers = store.getState().llm.providers
  const provider = providers.find((p) => p.id === assistant.model?.provider)
  return provider || getDefaultProvider()
}

export function getProviderByModel(model?: Model): Provider {
  const providers = store.getState().llm.providers
  const provider = providers.find((p) => p.id === model?.provider)

  if (!provider) {
    const defaultProvider = providers.find((p) => p.id === getDefaultModel()?.provider)
    const cherryinProvider = providers.find((p) => p.id === 'cherryin')
    return defaultProvider || cherryinProvider || providers[0]
  }

  return provider
}

export function getProviderByModelId(modelId?: string) {
  const providers = store.getState().llm.providers
  const _modelId = modelId || getDefaultModel().id
  return providers.find((p) => p.models.find((m) => m.id === _modelId)) as Provider
}

export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const getAssistantMaxTokens = () => {
    if (assistant.settings?.enableMaxTokens) {
      const maxTokens = assistant.settings.maxTokens
      if (typeof maxTokens === 'number') {
        return maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
      }
      return DEFAULT_MAX_TOKENS
    }
    return undefined
  }

  return {
    contextCount: contextCount === MAX_CONTEXT_COUNT ? UNLIMITED_CONTEXT_COUNT : contextCount,
    temperature: assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE,
    enableTemperature: assistant?.settings?.enableTemperature ?? true,
    topP: assistant?.settings?.topP ?? 1,
    enableTopP: assistant?.settings?.enableTopP ?? true,
    enableMaxTokens: assistant?.settings?.enableMaxTokens ?? false,
    maxTokens: getAssistantMaxTokens(),
    streamOutput: assistant?.settings?.streamOutput ?? true,
    toolUseMode: assistant?.settings?.toolUseMode ?? 'prompt',
    defaultModel: assistant?.defaultModel ?? undefined,
    reasoning_effort: assistant?.settings?.reasoning_effort ?? undefined,
    customParameters: assistant?.settings?.customParameters ?? []
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

export async function createAssistantFromAgent(agent: Agent) {
  const assistantId = uuid()
  const topic = getDefaultTopic(assistantId)

  const assistant: Assistant = {
    ...agent,
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    topics: [topic],
    model: agent.defaultModel,
    type: 'assistant',
    regularPhrases: agent.regularPhrases || [], // Ensured regularPhrases
    settings: agent.settings || DEFAULT_ASSISTANT_SETTINGS
  }

  store.dispatch(addAssistant(assistant))

  window.message.success({
    content: i18n.t('message.assistant.added.content'),
    key: 'assistant-added'
  })

  return assistant
}

// ============================================================================
// AI Extension Assistants - AI扩展助手创建函数
// ============================================================================

/**
 * 创建AI生成助手 - 用于创建新内容
 */
export function getAiGenerateAssistant(): Assistant {
  const quickModel = getQuickModel()
  const assistant: Assistant = getDefaultAssistant()

  assistant.id = 'ai-generate'
  assistant.name = 'AI Generate'
  assistant.emoji = '✨'
  assistant.prompt = AI_GENERATE_PROMPT
  assistant.model = quickModel
  assistant.settings = {
    temperature: 0.8, // 较高创造性
    enableTemperature: true,
    contextCount: DEFAULT_CONTEXTCOUNT,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true,
    topP: 0.9,
    enableTopP: true,
    toolUseMode: 'prompt',
    customParameters: []
  }

  return assistant
}

/**
 * 创建AI补全助手 - 用于文本补全
 */
export function getAiCompleteAssistant(): Assistant {
  const quickModel = getQuickModel()
  const assistant: Assistant = getDefaultAssistant()

  assistant.id = 'ai-complete'
  assistant.name = 'AI Complete'
  assistant.emoji = '🔄'
  assistant.prompt = AI_COMPLETE_PROMPT
  assistant.model = quickModel
  assistant.settings = {
    temperature: 0.7, // 中等创造性
    enableTemperature: true,
    contextCount: DEFAULT_CONTEXTCOUNT,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true, // 改为true以支持Tab补全的流式预览
    topP: 0.8,
    enableTopP: true,
    toolUseMode: 'prompt',
    customParameters: []
  }

  return assistant
}

/**
 * 创建AI改进助手 - 用于文本改进
 */
export function getAiImproveAssistant(): Assistant {
  const quickModel = getQuickModel()
  const assistant: Assistant = getDefaultAssistant()

  assistant.id = 'ai-improve'
  assistant.name = 'AI Improve'
  assistant.emoji = '📝'
  assistant.prompt = AI_IMPROVE_PROMPT
  assistant.model = quickModel
  assistant.settings = {
    temperature: 0.3, // 较低创造性，注重准确性
    enableTemperature: true,
    contextCount: DEFAULT_CONTEXTCOUNT,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true,
    topP: 0.7,
    enableTopP: true,
    toolUseMode: 'prompt',
    customParameters: []
  }

  return assistant
}

/**
 * 创建AI总结助手 - 用于文本总结
 */
export function getAiSummarizeAssistant(): Assistant {
  const quickModel = getQuickModel()
  const assistant: Assistant = getDefaultAssistant()

  assistant.id = 'ai-summarize'
  assistant.name = 'AI Summarize'
  assistant.emoji = '📋'
  assistant.prompt = AI_SUMMARIZE_PROMPT
  assistant.model = quickModel
  assistant.settings = {
    temperature: 0.2, // 低创造性，注重准确性
    enableTemperature: true,
    contextCount: DEFAULT_CONTEXTCOUNT,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true,
    topP: 0.6,
    enableTopP: true,
    toolUseMode: 'prompt',
    customParameters: []
  }

  return assistant
}

/**
 * 创建AI翻译助手 - 复用现有的翻译助手逻辑
 * 注意：这个函数需要目标语言和文本参数，所以在使用时需要动态创建
 */
export function getAiTranslateAssistant(targetLanguage: TranslateLanguage, text: string): TranslateAssistant {
  return getDefaultTranslateAssistant(targetLanguage, text)
}

/**
 * 创建AI拼写检查助手 - 用于拼写和语法检查
 */
export function getAiFixSpellingAssistant(): Assistant {
  const quickModel = getQuickModel()
  const assistant: Assistant = getDefaultAssistant()

  assistant.id = 'ai-fix-spelling'
  assistant.name = 'AI Fix Spelling'
  assistant.emoji = '✅'
  assistant.prompt = AI_FIX_SPELLING_PROMPT
  assistant.model = quickModel
  assistant.settings = {
    temperature: 0.1, // 极低创造性，注重准确性
    enableTemperature: true,
    contextCount: DEFAULT_CONTEXTCOUNT,
    enableMaxTokens: false,
    maxTokens: 0,
    streamOutput: true,
    topP: 0.5,
    enableTopP: true,
    toolUseMode: 'prompt',
    customParameters: []
  }

  return assistant
}
