import { forgetStreamingMarkdownAnimations } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { thinkingScrollService } from '@renderer/services/ThinkingScrollService'
import type { MessageUiState } from '@renderer/types/message'

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
  const ids = [...messageIds]
  for (const messageId of ids) cacheService.delete(cacheKey(messageId))
  invalidateCachedMessageMarkdownStates(ids)
}

export function invalidateCachedMessageMarkdownStates(messageIds: Iterable<string>): void {
  const prefixes = [...messageIds].map((id) => `${id}-part-`)
  const matches = (id: string) => prefixes.some((prefix) => id.startsWith(prefix))
  forgetStreamingMarkdownAnimations(matches)
  thinkingScrollService.deleteWhere(matches)
}
