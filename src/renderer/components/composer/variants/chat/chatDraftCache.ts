import { cacheService } from '@data/CacheService'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import type { ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const getChatDraftCacheKey = (topicId: string) => `chat-topic-draft-${topicId}`

export interface ChatComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
  knowledgeBaseIds: string[]
}

const EMPTY_DRAFT_CACHE: ChatComposerDraftCache = { text: '', tokens: [], files: [], knowledgeBaseIds: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readChatDraftCache(topicId: string): ChatComposerDraftCache {
  const cached = cacheService.getCasual<string | ChatComposerDraftCache>(getChatDraftCacheKey(topicId))
  if (typeof cached === 'string') return { ...EMPTY_DRAFT_CACHE, text: cached }
  if (!isRecord(cached)) return EMPTY_DRAFT_CACHE

  return {
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : [],
    files: Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : []
  }
}

export function writeChatDraftCache(topicId: string, draft: ChatComposerDraftCache) {
  cacheService.setCasual<ChatComposerDraftCache>(
    getChatDraftCacheKey(topicId),
    {
      text: draft.text,
      tokens: [...draft.tokens],
      files: [...draft.files],
      knowledgeBaseIds: [...draft.knowledgeBaseIds]
    },
    DRAFT_CACHE_TTL
  )
}
