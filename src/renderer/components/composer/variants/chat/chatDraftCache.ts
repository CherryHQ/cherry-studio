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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  const cached = cacheService.get(getChatDraftCacheKey(topicId))
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

export function hasChatDraftDocument(draft: ChatComposerDraftCache): boolean {
  return draft.text.length > 0 || draft.tokens.length > 0 || draft.files.length > 0 || draft.knowledgeBaseIds.length > 0
}

export function hasChatDraftContent(draft: ChatComposerDraftCache): boolean {
  return hasChatDraftDocument(draft) || draft.mentionedModelIds.length > 0
}

export function readChatDraftPresence(topicId: string): boolean {
  return hasChatDraftContent(readChatDraftCache(topicId))
}

export function subscribeChatDraftCache(topicId: string, listener: () => void): () => void {
  return cacheService.subscribe(getChatDraftCacheKey(topicId), listener)
}

/**
 * Clear the cached draft only when it still matches the draft that was just
 * enqueued: an unmount between submit and settlement persists the submitted
 * text, and without this reconcile the queued message reappears in the input
 * on reopen (cherry-pr-review). Newer edits rewrite the cache entry, so a
 * mismatch is preserved untouched.
 *
 * Only the submitted document fields participate in the match and the reset.
 * The selector fields (knowledgeBaseIds, mentionedModelIds, modelMultiSelectMode)
 * are conversation/composer-scope selections the user may have changed after
 * submitting; matching on them would resurrect the submitted document, and
 * clearing them here would silently revert that newer selection — normal
 * composer clearing preserves them too (cherry-pr-review
 * inv_b9cdc5f7ec400343, inv_7b04aab48bb4f87e).
 */
export function clearChatDraftCacheIfMatches(
  topicId: string,
  submitted: Pick<ChatComposerDraftCache, 'text' | 'tokens' | 'files'>
): void {
  const cached = readChatDraftCache(topicId)
  if (cached.text !== submitted.text) return
  if (JSON.stringify(cached.tokens) !== JSON.stringify(submitted.tokens)) return
  if (JSON.stringify(cached.files) !== JSON.stringify(submitted.files)) return
  writeChatDraftCache(topicId, {
    ...EMPTY_DRAFT_CACHE,
    knowledgeBaseIds: cached.knowledgeBaseIds,
    mentionedModelIds: cached.mentionedModelIds,
    modelMultiSelectMode: cached.modelMultiSelectMode
  })
}

export function writeChatDraftCache(topicId: string, draft: ChatComposerDraftCache) {
  cacheService.set(
    getChatDraftCacheKey(topicId),
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
}
