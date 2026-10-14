import { posix, win32 } from 'node:path'

import { isToolUIPart } from 'ai'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart, Message } from '@shared/data/types/message'

import type { ReadConversationResult } from './readConversation'

/** Project stored UI parts into evidence without attachment locators or runtime metadata. */
export function conversationPartEvidence(part: CherryMessagePart): Record<string, unknown> | null {
  if (isToolUIPart(part)) {
    return {
      type: part.type,
      toolCallId: part.toolCallId,
      toolName: part.type === 'dynamic-tool' ? part.toolName : undefined,
      state: part.state,
      input: part.input,
      output: part.state === 'output-available' ? part.output : undefined,
      errorText: part.state === 'output-error' ? part.errorText : undefined
    }
  }
  switch (part.type) {
    case 'text':
      return { type: part.type, text: part.text }
    case 'reasoning':
      return { type: part.type, omitted: true }
    case 'file':
      return {
        type: part.type,
        filename: part.filename ? win32.basename(posix.basename(part.filename)) : undefined,
        mediaType: part.mediaType,
        omitted: true
      }
    case 'source-url':
      return {
        type: part.type,
        sourceId: part.sourceId,
        title: part.title,
        url: /^https?:\/\//i.test(part.url) ? part.url : undefined
      }
    case 'source-document':
      return { type: part.type, sourceId: part.sourceId, title: part.title, mediaType: part.mediaType }
    case 'data-code':
      return { type: part.type, data: { content: part.data.content, language: part.data.language } }
    case 'data-compact':
      return { type: part.type, data: { content: part.data.content, compactedContent: part.data.compactedContent } }
    case 'data-error':
      return { type: part.type, data: { message: part.data.message, code: part.data.code } }
    case 'data-translation':
      return { type: part.type, data: { content: part.data.content, targetLanguage: part.data.targetLanguage } }
    case 'data-video':
      return { type: part.type, omitted: true }
    default:
      return null
  }
}

function messageEvidence(message: Message | AgentSessionMessageEntity) {
  return {
    id: message.id,
    role: message.role,
    modelId: message.modelId,
    data: { parts: (message.data.parts ?? []).map(conversationPartEvidence).filter((part) => part !== null) }
  }
}

export function conversationEvidence(conversation: ReadConversationResult) {
  if ('message' in conversation) {
    return { ...conversation, message: messageEvidence(conversation.message) }
  }
  if (conversation.source === 'topic') {
    return {
      ...conversation,
      messages: conversation.messages.map((entry) => ({
        message: messageEvidence(entry.message),
        siblingsGroup: entry.siblingsGroup?.map(messageEvidence)
      }))
    }
  }
  return { ...conversation, messages: conversation.messages.map(messageEvidence) }
}
