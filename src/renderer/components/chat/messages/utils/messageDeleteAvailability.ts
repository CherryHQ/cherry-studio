import type { MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import type { TFunction } from 'i18next'

type MessageDeleteUnavailableReason = Extract<MessageDeleteAvailability, { enabled: false }>['reason']

export function getMessageDeleteUnavailableText(
  reason: MessageDeleteUnavailableReason | undefined,
  t: TFunction
): string | undefined {
  if (reason === 'root-unavailable') return t('message.delete.root_unavailable')
  if (reason === 'first-turn') return t('message.delete.first_turn_not_supported')
  return undefined
}
