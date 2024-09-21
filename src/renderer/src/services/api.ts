import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import { Assistant, Message, Provider, Suggestion, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'

import AiProvider from '../providers/AiProvider'
import {
  getAssistantProvider,
  getDefaultModel,
  getProviderByModel,
  getTopNamingModel,
  getTranslateModel
} from './assistant'
import { EVENT_NAMES, EventEmitter } from './event'
import { filterMessages } from './messages'
import { estimateMessagesUsage } from './tokens'

export async function fetchChatCompletion({
  messages,
  topic,
  assistant,
  onResponse
}: {
  messages: Message[]
  topic: Topic
  assistant: Assistant
  onResponse: (message: Message) => void
}) {
  window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, false)

  const provider = getAssistantProvider(assistant)
  const defaultModel = getDefaultModel()
  const model = assistant.model || defaultModel
  const AI = new AiProvider(provider)

  store.dispatch(setGenerating(true))

  const message: Message = {
    id: uuid(),
    role: 'assistant',
    content: '',
    assistantId: assistant.id,
    topicId: topic.id,
    modelId: model.id,
    createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    status: 'sending'
  }

  onResponse({ ...message })

  // Handle paused state
  let paused = false
  const timer = setInterval(() => {
    if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) {
      paused = true
      message.status = 'paused'
      EventEmitter.emit(EVENT_NAMES.RECEIVE_MESSAGE, message)
      store.dispatch(setGenerating(false))
      onResponse({ ...message, status: 'paused' })
      clearInterval(timer)
    }
  }, 1000)

  try {
    let _messages: Message[] = []

    await AI.completions({
      messages,
      assistant,
      onFilterMessages: (messages) => (_messages = messages),
      onChunk: ({ text, usage }) => {
        message.content = message.content + text || ''
        message.usage = usage
        onResponse({ ...message, status: 'pending' })
      }
    })

    message.status = 'success'

    if (!message.usage || !message?.usage?.completion_tokens) {
      message.usage = await estimateMessagesUsage({
        assistant,
        messages: [..._messages, message]
      })
    }
  } catch (error: any) {
    message.content = `Error: ${error.message}`
    message.status = 'error'
  }

  timer && clearInterval(timer)

  if (paused) {
    return message
  }

  // Update message status
  message.status = window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED) ? 'paused' : message.status

  // Emit chat completion event
  EventEmitter.emit(EVENT_NAMES.RECEIVE_MESSAGE, message)

  // Reset generating state
  store.dispatch(setGenerating(false))

  return message
}

export async function fetchTranslate({ message, assistant }: { message: Message; assistant: Assistant }) {
  const model = getTranslateModel()

  if (!model) {
    return ''
  }

  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProvider(provider)

  try {
    return await AI.translate(message, assistant)
  } catch (error: any) {
    return ''
  }
}

export async function fetchMessagesSummary({ messages, assistant }: { messages: Message[]; assistant: Assistant }) {
  const model = getTopNamingModel() || assistant.model || getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return null
  }

  const AI = new AiProvider(provider)

  try {
    return await AI.summaries(filterMessages(messages), assistant)
  } catch (error: any) {
    return null
  }
}

export async function fetchGenerate({ prompt, content }: { prompt: string; content: string }): Promise<string> {
  const model = getDefaultModel()
  const provider = getProviderByModel(model)

  if (!hasApiKey(provider)) {
    return ''
  }

  const AI = new AiProvider(provider)

  try {
    return await AI.generateText({ prompt, content })
  } catch (error: any) {
    return ''
  }
}

export async function fetchSuggestions({
  messages,
  assistant
}: {
  messages: Message[]
  assistant: Assistant
}): Promise<Suggestion[]> {
  const provider = getAssistantProvider(assistant)
  const AI = new AiProvider(provider)
  const model = assistant.model

  if (!model) {
    return []
  }

  if (model.owned_by !== 'graphrag') {
    return []
  }

  if (model.id.endsWith('global')) {
    return []
  }

  try {
    return await AI.suggestions(filterMessages(messages), assistant)
  } catch (error: any) {
    return []
  }
}

export async function checkApi(provider: Provider) {
  const model = provider.models[0]
  const key = 'api-check'
  const style = { marginTop: '3vh' }

  if (provider.id !== 'ollama') {
    if (!provider.apiKey) {
      window.message.error({ content: i18n.t('message.error.enter.api.key'), key, style })
      return false
    }
  }

  if (!provider.apiHost) {
    window.message.error({ content: i18n.t('message.error.enter.api.host'), key, style })
    return false
  }

  if (!model) {
    window.message.error({ content: i18n.t('message.error.enter.model'), key, style })
    return false
  }

  const AI = new AiProvider(provider)

  const { valid } = await AI.check()

  window.message[valid ? 'success' : 'error']({
    key: 'api-check',
    style: { marginTop: '3vh' },
    duration: valid ? 2 : 8,
    content: valid ? i18n.t('message.api.connection.success') : i18n.t('message.api.connection.failed')
  })

  return valid
}

function hasApiKey(provider: Provider) {
  if (!provider) return false
  if (provider.id === 'ollama') return true
  return !isEmpty(provider.apiKey)
}

export async function fetchModels(provider: Provider) {
  const AI = new AiProvider(provider)

  try {
    return await AI.models()
  } catch (error) {
    return []
  }
}
