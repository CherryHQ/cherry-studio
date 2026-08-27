import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'

import { ConversationOutcomeKind } from '../../conversation'
import { dropEmptyContentParts, finalizeInterruptedParts, stripTransientStatusParts } from './PersistenceBackend'

export function normalizeTerminalMessage(
  finalMessage: CherryUIMessage | undefined,
  status: ConversationOutcomeKind,
  error?: SerializedError,
  anchorMessageId?: string
): CherryUIMessage | undefined {
  const message =
    status === ConversationOutcomeKind.Error && error
      ? mergeErrorIntoMessage(finalMessage, error, anchorMessageId)
      : finalMessage
  if (!message) return undefined
  return {
    ...message,
    parts: finalizeInterruptedParts(
      dropEmptyContentParts(stripTransientStatusParts(message.parts as CherryMessagePart[])),
      status
    )
  }
}

function mergeErrorIntoMessage(
  base: CherryUIMessage | undefined,
  error: SerializedError,
  anchorMessageId?: string
): CherryUIMessage {
  const errorPart: CherryMessagePart = { type: 'data-error', data: { ...error } }
  return {
    id: base?.id ?? anchorMessageId ?? crypto.randomUUID(),
    role: 'assistant',
    parts: [...((base?.parts ?? []) as CherryMessagePart[]), errorPart],
    ...(base?.metadata ? { metadata: base.metadata } : {})
  } as CherryUIMessage
}
