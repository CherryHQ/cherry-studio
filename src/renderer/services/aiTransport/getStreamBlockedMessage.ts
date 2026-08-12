import i18n from '@renderer/i18n/resolver'
import type { AiStreamOpenResponse } from '@shared/ai/transport'

type BlockedStreamResponse = Extract<AiStreamOpenResponse, { mode: 'blocked' }>

export function getStreamBlockedMessage(response: BlockedStreamResponse): string {
  return response.reason === 'paused' ? i18n.t('restore.messages_paused') : response.message
}
