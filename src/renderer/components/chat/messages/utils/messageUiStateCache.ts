import { cacheService } from '@data/CacheService'

import type { MessageUiState } from '../types'

type MessageUiStateUpdate = MessageUiState | ((current: MessageUiState) => MessageUiState)

function cacheKey(messageId: string) {
  return `message.ui.${messageId}` as const
}

export function getCachedMessageUiState(messageId: string): MessageUiState {
  return cacheService.get(cacheKey(messageId)) ?? {}
}

export function updateCachedMessageUiState(messageId: string, update: MessageUiStateUpdate): void {
  const current = getCachedMessageUiState(messageId)
  const next = typeof update === 'function' ? update(current) : { ...current, ...update }
  cacheService.set(cacheKey(messageId), next)
}

export function subscribeCachedMessageUiState(messageId: string, listener: () => void): () => void {
  return cacheService.subscribe(cacheKey(messageId), listener)
}

export function invalidateCachedMessageUiStates(messageIds: Iterable<string>): void {
  for (const messageId of messageIds) cacheService.delete(cacheKey(messageId))
}
