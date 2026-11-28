import { cacheService } from '@data/CacheService'
import type { CacheMessageEditDraft } from '@shared/data/cache/cacheValueTypes'

const MESSAGE_EDIT_DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const getMessageEditDraftCacheKey = (messageId: string) => `chat.message_edit_draft.${messageId}` as const

export type MessageEditDraftCache = CacheMessageEditDraft

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readMessageEditDraftCache(messageId: string): MessageEditDraftCache | undefined {
  const cached = cacheService.get(getMessageEditDraftCacheKey(messageId))
  if (!isRecord(cached)) return undefined

  return {
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : [],
    files: Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : [],
    ...(Array.isArray(cached.originalFileTokens)
      ? {
          originalFileTokens: cached.originalFileTokens.filter(
            (entry): entry is { tokenId: string; partIndex: number } =>
              isRecord(entry) &&
              typeof entry.tokenId === 'string' &&
              typeof entry.partIndex === 'number' &&
              Number.isInteger(entry.partIndex) &&
              entry.partIndex >= 0
          )
        }
      : {}),
    ...(typeof cached.reasoningText === 'string' ? { reasoningText: cached.reasoningText } : {})
  }
}

export function writeMessageEditDraftCache(messageId: string, draft: MessageEditDraftCache) {
  cacheService.set(
    getMessageEditDraftCacheKey(messageId),
    {
      text: draft.text,
      tokens: [...draft.tokens],
      files: [...draft.files],
      knowledgeBaseIds: [...draft.knowledgeBaseIds],
      originalFileTokens: draft.originalFileTokens?.map((entry) => ({ ...entry })),
      ...(draft.reasoningText !== undefined ? { reasoningText: draft.reasoningText } : {})
    },
    MESSAGE_EDIT_DRAFT_CACHE_TTL
  )
}

export function deleteMessageEditDraftCache(messageId: string) {
  cacheService.delete(getMessageEditDraftCacheKey(messageId))
}
