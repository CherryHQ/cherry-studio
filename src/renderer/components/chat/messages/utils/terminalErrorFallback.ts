import { hasRenderableContent } from '@shared/ai/messageRenderability'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { hasDismissedNoResponsePart } from '@shared/data/types/uiParts'

/**
 * Appends a localized "no response" error part to assistant messages that ended
 * without any visible content. The error branch covers an `error` status with
 * neither visible content nor a `data-error` part; it requires `!hasVisiblePart`
 * so an error turn that already shows answer content (e.g. streamed text before
 * the failure) does not get a misleading "No response" block. Shared by the
 * agents and home message list adapters. Returns the input map by reference
 * when nothing changes. This is a display fallback for historical / abnormal
 * chains; the authoritative empty-success → error transition is owned by
 * `AiStreamManager`.
 */
export function withTerminalErrorFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string
): Record<string, CherryMessagePart[]> {
  let next = partsByMessageId

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.metadata?.status !== 'error') continue
    const parts = partsByMessageId[message.id] ?? message.parts ?? []
    if (hasDismissedNoResponsePart(parts)) continue
    if (hasRenderableContent(parts)) continue
    if (parts.some((part) => part.type === 'data-error')) continue

    if (next === partsByMessageId) next = { ...partsByMessageId }
    next[message.id] = [...parts, createNoResponsePart(noResponseMessage)]
  }

  return next
}

/**
 * Ordinary-chat display fallback for historical empty `success` turns with no
 * visible content. Agent Sessions keep empty turns as legitimate success, so
 * only Home composes this alongside `withTerminalErrorFallback`.
 */
export function withEmptySuccessFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string
): Record<string, CherryMessagePart[]> {
  let next = partsByMessageId

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.metadata?.status !== 'success') continue
    const parts = partsByMessageId[message.id] ?? message.parts ?? []
    if (hasDismissedNoResponsePart(parts)) continue
    if (hasRenderableContent(parts)) continue

    if (next === partsByMessageId) next = { ...partsByMessageId }
    next[message.id] = [...parts, createNoResponsePart(noResponseMessage)]
  }

  return next
}

/**
 * Home display fallback: terminal errors plus historical empty successes.
 * Agent Sessions use `withTerminalErrorFallback` alone since an empty turn is
 * legitimate there.
 */
export function withNoResponseFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string
): Record<string, CherryMessagePart[]> {
  const withErrors = withTerminalErrorFallback(messages, partsByMessageId, noResponseMessage)
  return withEmptySuccessFallback(messages, withErrors, noResponseMessage)
}

function createNoResponsePart(noResponseMessage: string): CherryMessagePart {
  return {
    type: 'data-error',
    data: { name: 'NoResponseError', message: noResponseMessage, stack: null, i18nKey: 'no_response' }
  }
}
