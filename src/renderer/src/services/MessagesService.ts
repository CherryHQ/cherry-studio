import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { DEFAULT_CONTEXTCOUNT } from '@renderer/config/constant'
import { getTopicById } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { Assistant, Message, Model, Topic } from '@renderer/types'
import { getTitleFromString, uuid } from '@renderer/utils'
import dayjs from 'dayjs'
import { isEmpty, remove, takeRight } from 'lodash'
import { NavigateFunction } from 'react-router'

import { getAssistantById, getDefaultModel } from './AssistantService'
import { EVENT_NAMES, EventEmitter } from './EventService'
import FileManager from './FileManager'

export const filterMessages = (messages: Message[]) => {
  return messages
    .filter((message) => !['@', 'clear'].includes(message.type!))
    .filter((message) => !isEmpty(message.content.trim()))
}

export function filterContextMessages(messages: Message[]): Message[] {
  const clearIndex = messages.findLastIndex((message) => message.type === 'clear')

  if (clearIndex === -1) {
    return messages
  }

  return messages.slice(clearIndex + 1)
}

export function filterUserRoleStartMessages(messages: Message[]): Message[] {
  const firstUserMessageIndex = messages.findIndex((message) => message.role === 'user')

  if (firstUserMessageIndex === -1) {
    return messages
  }

  return messages.slice(firstUserMessageIndex)
}

export function filterUsefulMessages(messages: Message[]): Message[] {
  const _messages = messages
  const groupedMessages = getGroupedMessages(messages)

  Object.entries(groupedMessages).forEach(([key, messages]) => {
    if (key.startsWith('assistant')) {
      const usefulMessage = messages.find((m) => m.useful === true)
      if (usefulMessage) {
        messages.forEach((m) => {
          if (m.id !== usefulMessage.id) {
            remove(_messages, (o) => o.id === m.id)
          }
        })
      } else {
        messages?.slice(0, -1).forEach((m) => {
          remove(_messages, (o) => o.id === m.id)
        })
      }
    }
  })

  while (_messages.length > 0 && _messages[_messages.length - 1].role === 'assistant') {
    _messages.pop()
  }

  return _messages
}

export function getContextCount(assistant: Assistant, messages: Message[]) {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const _messages = takeRight(messages, contextCount)
  const clearIndex = _messages.findLastIndex((message) => message.type === 'clear')
  const messagesCount = _messages.length

  if (clearIndex === -1) {
    return contextCount
  }

  return messagesCount - (clearIndex + 1)
}

export function deleteMessageFiles(message: Message) {
  message.files && FileManager.deleteFiles(message.files)
}

export function isGenerating() {
  return new Promise((resolve, reject) => {
    const generating = store.getState().runtime.generating
    generating && window.message.warning({ content: i18n.t('message.switch.disabled'), key: 'switch-assistant' })
    generating ? reject(false) : resolve(true)
  })
}

export async function locateToMessage(navigate: NavigateFunction, message: Message) {
  await isGenerating()

  SearchPopup.hide()
  const assistant = getAssistantById(message.assistantId)
  const topic = await getTopicById(message.topicId)

  navigate('/', { state: { assistant, topic } })

  setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  setTimeout(() => EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + message.id), 300)
}

export function getUserMessage({
  assistant,
  topic,
  type,
  content
}: {
  assistant: Assistant
  topic: Topic
  type: Message['type']
  content?: string
}): Message {
  const defaultModel = getDefaultModel()
  const model = assistant.model || defaultModel

  return {
    id: uuid(),
    role: 'user',
    content: content || '',
    assistantId: assistant.id,
    topicId: topic.id,
    model,
    createdAt: new Date().toISOString(),
    type,
    status: 'success'
  }
}

export function getAssistantMessage({ assistant, topic }: { assistant: Assistant; topic: Topic }): Message {
  const defaultModel = getDefaultModel()
  const model = assistant.model || defaultModel

  return {
    id: uuid(),
    role: 'assistant',
    content: '',
    assistantId: assistant.id,
    topicId: topic.id,
    model,
    createdAt: new Date().toISOString(),
    type: 'text',
    status: 'sending'
  }
}

export function getGroupedMessages(messages: Message[]): { [key: string]: (Message & { index: number })[] } {
  const groups: { [key: string]: (Message & { index: number })[] } = {}
  messages.forEach((message, index) => {
    const key = message.askId ? 'assistant' + message.askId : 'user' + message.id
    if (key && !groups[key]) {
      groups[key] = []
    }
    groups[key].unshift({ ...message, index })
  })
  return groups
}

export function getMessageModelId(message: Message) {
  return message?.model?.id || message.modelId
}

export function resetAssistantMessage(message: Message, model?: Model): Message {
  return {
    ...message,
    model: model || message.model,
    content: '',
    status: 'sending',
    translatedContent: undefined,
    reasoning_content: undefined,
    usage: undefined,
    metrics: undefined,
    metadata: undefined,
    useful: undefined
  }
}

export function getMessageTitle(message: Message, length = 30) {
  let title = getTitleFromString(message.content, length)

  if (!title) {
    title = dayjs(message.createdAt).format('YYYYMMDDHHmm')
  }

  return title
}
