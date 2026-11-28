import { APICallError, RetryError } from 'ai'

import type { AiStreamRequest } from '@main/ai/types'
import { getSafeProviderErrorMessage } from '@shared/ai/providerError'
import type { SerializedError } from '@shared/types/error'
import { classifyErrorCategory } from '@shared/utils/errorCategory'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { serializeError } from './serializeError'

export function serializeChatStreamError(
  error: unknown,
  request: Pick<AiStreamRequest, 'runtime' | 'contextOwner'>
): SerializedError {
  const serialized = serializeError(error)
  if (request.runtime?.kind === 'agent-session' || request.contextOwner === 'caller') return serialized
  if (typeof serialized.statusCode === 'number' && ![400, 413].includes(serialized.statusCode)) return serialized
  if (typeof serialized.finishReason === 'string' && serialized.finishReason.trim()) return serialized

  let terminal = error
  for (let depth = 0; depth < 5 && RetryError.isInstance(terminal); depth++) terminal = terminal.lastError
  if (!APICallError.isInstance(terminal)) return serialized
  if (terminal.statusCode !== undefined && terminal.statusCode !== 400 && terminal.statusCode !== 413) return serialized

  const terminalSerialized = serializeError(terminal)
  if (
    typeof terminalSerialized.providerErrorCategory === 'string' &&
    !['payload', 'bad_request', 'unknown'].includes(terminalSerialized.providerErrorCategory)
  )
    return serialized
  if (
    typeof serialized.providerErrorCategory === 'string' &&
    !['payload', 'bad_request', 'unknown'].includes(serialized.providerErrorCategory)
  )
    return serialized
  const providerMessage = getSafeProviderErrorMessage(terminal)
  if (!['payload', 'bad_request', 'unknown'].includes(classifyErrorCategory({ text: providerMessage })))
    return serialized
  const reason = redactSecretTokens(
    redactSecretText(providerMessage.replace(/data:[^\s,;]+(?:;[^\s,;]+)*;base64,[A-Za-z0-9+/=_-]*/gi, '<redacted>'))
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  if (!/\bDownloaded image content cannot exceed\s+\d+(?:\.\d+)?\s*Mi?B\b/i.test(reason)) return serialized

  const body = terminal.requestBodyValues
  if (!body || typeof body !== 'object' || !('messages' in body) || !Array.isArray(body.messages)) return serialized
  const hasImage = body.messages.some((message: unknown) => {
    if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content))
      return false
    return message.content.some((part: unknown) => {
      if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'image_url' || !('image_url' in part))
        return false
      const image = part.image_url
      return (
        !!image &&
        typeof image === 'object' &&
        'url' in image &&
        typeof image.url === 'string' &&
        image.url.trim().length > 0
      )
    })
  })
  if (!hasImage) return serialized
  return {
    ...serialized,
    providerErrorCategory: 'payload',
    i18nKey: 'diagnosis.payload',
    detailI18nKey: 'image_payload_rejection_detail',
    detailI18nValues: { reason }
  }
}
