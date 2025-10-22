import { StreamTextParams } from './aiCoreTypes'
import { Assistant } from './assistant'
import { Chunk } from './chunk'
import { Message } from './newMessage'

export type Tab = 'assistants' | 'topic' | 'settings'

export enum TopicType {
  Chat = 'chat',
  Session = 'session'
}

export type Topic = {
  id: string
  type?: TopicType
  assistantId: string
  name: string
  createdAt: string
  updatedAt: string
  messages: Message[]
  pinned?: boolean
  prompt?: string
  isNameManuallyEdited?: boolean
}

export type FetchChatCompletionOptions = {
  signal?: AbortSignal
  timeout?: number
  headers?: Record<string, string>
}

type BaseParams = {
  assistant: Assistant
  options?: FetchChatCompletionOptions
  onChunkReceived: (chunk: Chunk) => void
  topicId?: string // 添加 topicId 参数
  uiMessages?: Message[]
}

type MessagesParams = BaseParams & {
  messages: StreamTextParams['messages']
  prompt?: never
}

type PromptParams = BaseParams & {
  messages?: never
  // prompt: Just use string for convinience. Native prompt type unite more types, including messages type.
  // we craete a non-intersecting prompt type to discriminate them.
  // see https://github.com/vercel/ai/issues/8363
  prompt: string
}

export type FetchChatCompletionParams = MessagesParams | PromptParams
