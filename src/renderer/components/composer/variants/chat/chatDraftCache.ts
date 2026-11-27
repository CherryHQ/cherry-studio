import { isEqual } from 'es-toolkit/compat'

import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { CacheChatComposerDraft } from '@shared/data/cache/cacheValueTypes'
import { isUniqueModelId } from '@shared/data/types/model'

import { type ComposerSerializedDraft, excludeComposerDraftTokens } from '../../tokens'

const logger = loggerService.withContext('chatDraftCache')
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const DRAFT_CACHE_PREFIX = 'chat.composer_draft.'

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

function readWindowDraftText(key: string): string {
  try {
    const entry: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (
      isRecord(entry) &&
      typeof entry.text === 'string' &&
      typeof entry.expiresAt === 'number' &&
      entry.expiresAt > Date.now()
    ) {
      return entry.text
    }
  } catch {
    logger.warn('Could not read chat draft from window storage')
  }
  return ''
}

function removeExpiredWindowDrafts(storage: Storage) {
  let removed = false
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (!key?.startsWith(DRAFT_CACHE_PREFIX)) continue
    try {
      const entry: unknown = JSON.parse(storage.getItem(key) ?? 'null')
      if (isRecord(entry) && typeof entry.expiresAt === 'number' && entry.expiresAt <= Date.now()) {
        storage.removeItem(key)
        removed = true
      }
    } catch {
      // A malformed snapshot must not prevent reclaiming other expired drafts.
    }
  }
  return removed
}

export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  const key = getChatDraftCacheKey(topicId)
  const cached = cacheService.get(key)
  if (!isRecord(cached)) {
    const text = readWindowDraftText(key)
    return text ? { ...EMPTY_DRAFT_CACHE, text } : EMPTY_DRAFT_CACHE
  }

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
  const key = getChatDraftCacheKey(topicId)
  cacheService.set(
    key,
    {
      text: draft.text,
      tokens: [...draft.tokens],
      files: [...draft.files],
      knowledgeBaseIds: [...draft.knowledgeBaseIds],
      mentionedModelIds: [...draft.mentionedModelIds],
      modelMultiSelectMode: draft.modelMultiSelectMode
    },
    DRAFT_CACHE_TTL
  )
  // URLs and filled variables are user input; other token prompts depend on transient context.
  const { text } = excludeComposerDraftTokens(
    draft,
    (token) => token.kind !== 'link' && token.kind !== 'promptVariable'
  )
  try {
    const storage = sessionStorage
    // Remove the previous snapshot first so a failed write cannot restore stale text.
    storage.removeItem(key)
    if (text) {
      const snapshot = JSON.stringify({ text, expiresAt: Date.now() + DRAFT_CACHE_TTL })
      try {
        storage.setItem(key, snapshot)
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
        if (!removeExpiredWindowDrafts(storage)) throw error
        storage.setItem(key, snapshot)
      }
    }
  } catch {
    logger.warn('Could not save chat draft to window storage')
  }
}

export function clearSubmittedChatDraftCache(topicId: string, submitted: ComposerSerializedDraft) {
  const current = readChatDraftCache(topicId)
  if (current.text !== submitted.text || !isEqual(current.tokens, submitted.tokens)) return
  writeChatDraftCache(topicId, { ...current, text: '', tokens: [], files: [] })
}
