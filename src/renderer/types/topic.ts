import type { Message } from './newMessage'

export enum TopicType {
  Chat = 'chat',
  Session = 'session'
}

export type Topic = {
  id: string
  type?: TopicType
  /**
   * Last-used assistant id. `undefined` means the topic has no associated
   * assistant (e.g. a first-launch temp topic, or a topic created before any
   * assistant was selected). Renderer code must NOT substitute a sentinel —
   * callers should branch on `undefined` and fall back to UI defaults.
   */
  assistantId: string | undefined
  name: string
  createdAt: string
  updatedAt: string
  orderKey?: string
  traceId?: string
  messages: Message[]
  pinned?: boolean
  prompt?: string
  isNameManuallyEdited?: boolean
}
