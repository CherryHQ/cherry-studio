import { cacheService } from '@data/CacheService'
import type { CacheChatComposerDraft } from '@shared/data/cache/cacheValueTypes'
import { isUniqueModelId } from '@shared/data/types/model'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

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

/**
 * localStorage mirrors each draft under the same key so a window reload (or full restart) can
 * restore it; the memory tier stays the live read/write path within a session. Expiry is checked
 * on read because localStorage has no TTL of its own.
 */
type PersistedChatDraftEntry = {
  expiresAt: number
  value: ChatComposerDraftCache
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDraftCache(cached: unknown): ChatComposerDraftCache | null {
  if (!isRecord(cached)) return null

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

function readPersistedChatDraft(topicId: string): ChatComposerDraftCache | null {
  const key = getChatDraftCacheKey(topicId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(key)
      return null
    }

    return normalizeDraftCache(parsed.value)
  } catch {
    return null
  }
}

function writePersistedChatDraft(topicId: string, draft: ChatComposerDraftCache) {
  const key = getChatDraftCacheKey(topicId)
  try {
    if (hasChatDraftContent(draft)) {
      const entry: PersistedChatDraftEntry = { expiresAt: Date.now() + DRAFT_CACHE_TTL, value: draft }
      localStorage.setItem(key, JSON.stringify(entry))
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // Quota or serialization failure: the memory tier still holds the draft for this session.
  }
}

// Remove persisted drafts whose TTL already elapsed (e.g. for topics that no longer exist).
// Runs once per session, on the first draft read or write.
let expiredDraftsPruned = false
function pruneExpiredPersistedChatDrafts() {
  if (expiredDraftsPruned) return
  expiredDraftsPruned = true
  try {
    const now = Date.now()
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (!key?.startsWith('chat.composer_draft.')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Best effort only; unreadable entries expire on their own read path.
  }
}

export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  pruneExpiredPersistedChatDrafts()

  const cached = normalizeDraftCache(cacheService.get(getChatDraftCacheKey(topicId)))
  if (cached) return cached

  // After a window reload the memory tier is empty; rehydrate it from the persisted mirror.
  const persisted = readPersistedChatDraft(topicId)
  if (persisted) {
    cacheService.set(getChatDraftCacheKey(topicId), persisted, DRAFT_CACHE_TTL)
    return persisted
  }

  return EMPTY_DRAFT_CACHE
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

export function writeChatDraftCache(topicId: string, draft: ChatComposerDraftCache) {
  pruneExpiredPersistedChatDrafts()

  const value: ChatComposerDraftCache = {
    text: draft.text,
    tokens: [...draft.tokens],
    files: [...draft.files],
    knowledgeBaseIds: [...draft.knowledgeBaseIds],
    mentionedModelIds: [...draft.mentionedModelIds],
    modelMultiSelectMode: draft.modelMultiSelectMode
  }
  cacheService.set(getChatDraftCacheKey(topicId), value, DRAFT_CACHE_TTL)
  writePersistedChatDraft(topicId, value)
}
