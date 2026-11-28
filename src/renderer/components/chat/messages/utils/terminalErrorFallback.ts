import { messageProjectionService } from '@renderer/services/aiTransport'
import { type MessagePartRows, PartOverrides, messagePartsAt } from '@renderer/utils/message/messagePartRows'
import { hasRenderableContent, isSteerHandoffEmptySuccess } from '@shared/ai/messageRenderability'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { isHiddenPart } from '../blocks/messagePartLayouts'
import { hasDismissedNoResponsePart } from './dismissedNoResponse'

/**
 * Appends a localized "no response" error part to assistant messages that ended
 * without any visible content. The error branch covers an `error` status with
 * neither visible content nor a `data-error` part; it requires `!hasVisiblePart`
 * so an error turn that already shows answer content (e.g. streamed text before
 * the failure) does not get a misleading "No response" block. Shared by the
 * agents and home message list adapters. Returns the input rows by reference
 * when nothing changes. This is a display fallback for historical / abnormal
 * chains; the authoritative empty-success → error transition is owned by
 * `AiStreamManager`.
 */
export function withTerminalErrorFallback(
  messages: CherryUIMessage[],
  partsByMessageId: MessagePartRows,
  noResponseMessage: string
): MessagePartRows {
  const replacements = new Map<string, CherryMessagePart[]>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const parts = messagePartsAt(partsByMessageId, message.id) ?? message.parts ?? []
    const resolvedParts = messageProjectionService.ownsRowParts(parts)
      ? messageProjectionService.readParts(parts)
      : parts
    const hasVisiblePart = resolvedParts.some((part) => !isHiddenPart(part))
    if (message.metadata?.provenance && hasVisiblePart) continue
    // Imported-history rows surface their original terminal status instead of a
    // synthesized error; an imported row never gets the no-response fallback.
    if (message.metadata?.importedHistory) {
      if (message.metadata?.status === 'error' || !hasVisiblePart) {
        replacements.set(message.id, [
          ...resolvedParts,
          { type: 'data-imported-status', data: { status: message.metadata.importedHistory.status } }
        ])
      }
      continue
    }
    if (message.metadata?.status !== 'error') continue
    if (hasDismissedNoResponsePart(resolvedParts)) continue
    if (hasRenderableContent(resolvedParts)) continue
    if (resolvedParts.some((part) => part.type === 'data-error')) continue

    replacements.set(message.id, [...resolvedParts, createNoResponsePart(noResponseMessage)])
  }

  return replacements.size ? new PartOverrides(partsByMessageId, replacements) : partsByMessageId
}

/**
 * Ordinary-chat display fallback for historical empty `success` turns with no
 * visible content. Agent Sessions rely on `withTerminalErrorFallback` alone;
 * only Home composes this alongside it for legacy ordinary-chat rows.
 */
export function withEmptySuccessFallback(
  messages: CherryUIMessage[],
  partsByMessageId: MessagePartRows,
  noResponseMessage: string
): MessagePartRows {
  const replacements = new Map<string, CherryMessagePart[]>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    if (message.metadata?.status !== 'success') continue
    const parts = messagePartsAt(partsByMessageId, message.id) ?? message.parts ?? []
    const resolvedParts = messageProjectionService.ownsRowParts(parts)
      ? messageProjectionService.readParts(parts)
      : parts
    if (hasDismissedNoResponsePart(resolvedParts)) continue
    if (hasRenderableContent(resolvedParts)) continue
    if (isSteerHandoffEmptySuccess(resolvedParts)) continue

    replacements.set(message.id, [...resolvedParts, createNoResponsePart(noResponseMessage)])
  }

  return replacements.size ? new PartOverrides(partsByMessageId, replacements) : partsByMessageId
}

/**
 * Home display fallback: terminal errors plus historical empty successes.
 * Agent Sessions use `withTerminalErrorFallback` alone since an empty turn is
 * legitimate there.
 */
export function withNoResponseFallback(
  messages: CherryUIMessage[],
  partsByMessageId: MessagePartRows,
  noResponseMessage: string
): MessagePartRows {
  const withErrors = withTerminalErrorFallback(messages, partsByMessageId, noResponseMessage)
  return withEmptySuccessFallback(messages, withErrors, noResponseMessage)
}

function createNoResponsePart(noResponseMessage: string): CherryMessagePart {
  return {
    type: 'data-error',
    data: { name: 'NoResponseError', message: noResponseMessage, stack: null, i18nKey: 'no_response' }
  }
}
