import type { CherryUIMessage } from '@shared/data/types/message'

/** Assistant rows eligible for in-place retry / composer model override on regenerate. */
export function isFailedAssistantMessage(message: Pick<CherryUIMessage, 'role' | 'parts' | 'metadata'>): boolean {
  const status = message.metadata?.status
  return (
    message.role === 'assistant' &&
    status !== 'pending' &&
    (status === 'error' || status === 'paused' || (message.parts?.length ?? 0) === 0)
  )
}
