import { cacheService } from '@data/CacheService'
import type { CacheChatComposerDraft } from '@shared/data/cache/cacheValueTypes'
import { isUniqueModelId } from '@shared/data/types/model'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const DRAFT_SNAPSHOT_KEY = 'chat.composer_draft_snapshot' as const

export const getChatDraftCacheKey = (topicId: string) => `chat.composer_draft.${topicId}` as const

export type ChatComposerDraftCache = CacheChatComposerDraft

const EMPTY_DRAFT_CACHE: ChatComposerDraftCache = {
  text: '',
  tokens: [],
  files: [],
  knowledgeBaseIds: [],
  mentionedModelIds: [],
  modelMultiSelectMode: false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDraftCache(cached: unknown): ChatComposerDraftCache {
  if (!isRecord(cached)) return EMPTY_DRAFT_CACHE

  return {
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : [],
    files: Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : [],
    mentionedModelIds: Array.isArray(cached.mentionedModelIds) ? cached.mentionedModelIds.filter(isUniqueModelId) : [],
    modelMultiSelectMode: cached.modelMultiSelectMode === true
  }
}

// Renderer memory is empty for this topic right after an app restart; fall back to the
// persisted crash-recovery snapshot written by writeChatDraftCache.
export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  const cached = cacheService.get(getChatDraftCacheKey(topicId))
  if (cached !== undefined) return normalizeDraftCache(cached)
  return normalizeDraftCache(cacheService.getPersist(DRAFT_SNAPSHOT_KEY)[topicId])
}

export function hasChatDraftContent(draft: ChatComposerDraftCache): boolean {
  return (
    draft.text.length > 0 ||
    draft.tokens.length > 0 ||
    draft.files.length > 0 ||
    draft.knowledgeBaseIds.length > 0 ||
    draft.mentionedModelIds.length > 0
  )
}

export function readChatDraftPresence(topicId: string): boolean {
  return hasChatDraftContent(readChatDraftCache(topicId))
}

export function subscribeChatDraftCache(topicId: string, listener: () => void): () => void {
  return cacheService.subscribe(getChatDraftCacheKey(topicId), listener)
}

// Mirrors the draft into a persisted snapshot keyed by topic id so unsent text survives an
// app restart; the entry is dropped once the draft empties (sent or cleared).
export function writeChatDraftCache(topicId: string, draft: ChatComposerDraftCache) {
  const normalized: ChatComposerDraftCache = {
    text: draft.text,
    tokens: [...draft.tokens],
    files: [...draft.files],
    knowledgeBaseIds: [...draft.knowledgeBaseIds],
    mentionedModelIds: [...draft.mentionedModelIds],
    modelMultiSelectMode: draft.modelMultiSelectMode
  }
  cacheService.set(getChatDraftCacheKey(topicId), normalized, DRAFT_CACHE_TTL)
  cacheService.setPersist(DRAFT_SNAPSHOT_KEY, (prev) => {
    if (!hasChatDraftContent(draft)) {
      if (!(topicId in prev)) return prev
      const next = { ...prev }
      delete next[topicId]
      return next
    }
    return { ...prev, [topicId]: normalized }
  })
}
