/**
 * `Message` → AI SDK `UIMessage` / `ModelMessage`, with `file://` URLs
 * rewritten to inline data URLs (AI SDK's `convertToModelMessages`
 * doesn't fetch `file://`).
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage, Message } from '@shared/data/types/message'
import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai'

import { resolveFileUIPart } from './fileProcessor'

const logger = loggerService.withContext('ai:messageConverter')

export function toCherryUIMessage(message: Message): CherryUIMessage {
  const parts: CherryMessagePart[] = message.data?.parts ?? []
  if (!parts.length) {
    logger.debug('Message has no v2 parts — did the v1→v2 migration run?', { messageId: message.id })
  }
  return {
    id: message.id,
    role: message.role,
    parts
  } as CherryUIMessage
}

/** Unresolvable file parts are dropped with a warning. */
async function resolveMessageParts<T extends UIMessage>(message: T): Promise<T> {
  if (!message.parts?.length) return message

  const resolved: UIMessage['parts'] = []
  for (const part of message.parts) {
    if (part.type === 'file') {
      const next = await resolveFileUIPart(part)
      if (next) resolved.push(next as UIMessage['parts'][number])
      else logger.warn('Dropped unresolved file part', { messageId: message.id })
      continue
    }
    resolved.push(part as UIMessage['parts'][number])
  }

  return { ...message, parts: resolved } as T
}

/** Idempotent for non-file parts and non-`file://` URLs. */
export async function resolveUIMessageFileUrls<T extends UIMessage = UIMessage>(messages: T[]): Promise<T[]> {
  return Promise.all(messages.map(resolveMessageParts))
}

export async function prepareModelMessages(messages: Message[]): Promise<ModelMessage[]> {
  const uiMessages = await resolveUIMessageFileUrls(messages.map(toCherryUIMessage))
  return convertToModelMessages(uiMessages)
}

export async function prepareUIMessages(messages: Message[]): Promise<CherryUIMessage[]> {
  return resolveUIMessageFileUrls(messages.map(toCherryUIMessage))
}
