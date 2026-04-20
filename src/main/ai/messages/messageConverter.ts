/**
 * Main-process message converter.
 *
 * Cherry v2 stores messages as `Message.data.parts` — AI SDK's native
 * `UIMessagePart[]` format. This module's job is the thin glue to turn a
 * sequence of v2 `Message` rows into AI-SDK-native `UIMessage[]` /
 * `ModelMessage[]`, preprocessing any `file://` URLs into inline data URLs
 * so the providers actually receive bytes.
 *
 * Ported from renderer `aiCore/prepareParams/messageConverter.ts`
 * (origin/main). Differences:
 *   - v2 uses `data.parts` (AI-SDK native) as the canonical form; this
 *     module doesn't walk legacy `data.blocks`. If a message lacks `parts`,
 *     the renderer's `blocksToParts` should run upstream (in the v1→v2
 *     migration or the renderer send path) before messages reach Main.
 *   - File parts with `file://` URLs are rewritten to base64 data URLs via
 *     `resolveFileUIPart` (see `./fileProcessor`) — renderer did this via
 *     IPC round-trips; Main can read disk directly.
 */

import { loggerService } from '@logger'
import type { CherryMessagePart, CherryUIMessage, Message } from '@shared/data/types/message'
import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai'

import { resolveFileUIPart } from './fileProcessor'

const logger = loggerService.withContext('ai:messageConverter')

/**
 * Wrap a v2 `Message` in AI SDK `UIMessage` shape. Parts are used verbatim
 * — resolution of `file://` URLs happens later in
 * `prepareModelMessages`.
 */
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

/**
 * Resolve any `file://` URLs in a single `UIMessage`'s file parts to base64
 * data URLs. Parts that can't be resolved are dropped with a warning.
 */
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

/**
 * Rewrite `file://` URLs to base64 data URLs in every `UIMessage`'s file
 * parts. Idempotent for non-file parts and non-`file://` URLs.
 *
 * Call this at the boundary between "received from caller" and "handed to
 * AI SDK" — AI SDK's `convertToModelMessages` doesn't fetch `file://`
 * URLs, so the provider would otherwise see bogus links.
 */
export async function resolveUIMessageFileUrls<T extends UIMessage = UIMessage>(messages: T[]): Promise<T[]> {
  return Promise.all(messages.map(resolveMessageParts))
}

/**
 * Turn a sequence of v2 `Message` rows into AI SDK `ModelMessage[]` ready
 * for `streamText` / `generateText`. File parts are inlined as data URLs
 * before `convertToModelMessages` runs.
 */
export async function prepareModelMessages(messages: Message[]): Promise<ModelMessage[]> {
  const uiMessages = await resolveUIMessageFileUrls(messages.map(toCherryUIMessage))
  return convertToModelMessages(uiMessages)
}

/**
 * Same as `prepareModelMessages` but returns the `UIMessage[]` form, for
 * callers that want to hand UI messages to `streamText` directly (AI SDK
 * runs its own `convertToModelMessages` under the hood).
 */
export async function prepareUIMessages(messages: Message[]): Promise<CherryUIMessage[]> {
  return resolveUIMessageFileUrls(messages.map(toCherryUIMessage))
}
