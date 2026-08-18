import type { MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import type { TFunction } from 'i18next'

type MessageDeleteUnavailableReason = Extract<MessageDeleteAvailability, { enabled: false }>['reason']

export function getMessageDeleteUnavailableText(
  reason: MessageDeleteUnavailableReason | undefined,
  t: TFunction
): string | undefined {
  if (reason === 'not-loaded') return t('message.delete.root_unavailable')
  if (reason === 'generating') return t('message.delete.generating_unavailable')
  return undefined
}
