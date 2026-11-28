import i18n from '@renderer/i18n/resolver'
import { LocalizedToastError } from '@renderer/utils/errorToast'
import type { AiStreamOpenResponse } from '@shared/ai/transport'

type BlockedStreamResponse = Extract<AiStreamOpenResponse, { mode: 'blocked' }>

export function getStreamBlockedMessage(response: BlockedStreamResponse): string {
  return response.reason === 'paused' ? i18n.t('restore.messages_paused') : response.message
}

/** The paused reason is app copy, so it titles the toast; other reasons stay raw details. */
export function getStreamBlockedError(response: BlockedStreamResponse): Error {
  const message = getStreamBlockedMessage(response)
  return response.reason === 'paused' ? new LocalizedToastError(message) : new Error(message)
}
