import { cacheService } from '@data/CacheService'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import type { ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'

export interface ChatComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
}

const EMPTY_DRAFT_CACHE: ChatComposerDraftCache = { text: '', tokens: [], files: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Knowledge-base selection is scoped per (topic + assistant) and reset on switch, so knowledge
// tokens must not follow the global draft. Dropping them is offset-safe: they contribute no
// promptText to the serialized text.
export function getCacheableDraftTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => token.kind !== 'knowledge')
}

export function readChatDraftCache(): ChatComposerDraftCache {
  const cached = cacheService.getCasual<string | ChatComposerDraftCache>(INPUTBAR_DRAFT_CACHE_KEY)
  if (typeof cached === 'string') return { text: cached, tokens: [], files: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return EMPTY_DRAFT_CACHE
  }

  return {
    text: cached.text,
    tokens: getCacheableDraftTokens(cached.tokens),
    files: Array.isArray(cached.files) ? cached.files : []
  }
}

export function writeChatDraftCache(
  text: string,
  tokens: readonly ComposerSerializedToken[],
  files: readonly ComposerAttachment[]
) {
  cacheService.setCasual<ChatComposerDraftCache>(
    INPUTBAR_DRAFT_CACHE_KEY,
    {
      text,
      tokens: getCacheableDraftTokens(tokens),
      files: [...files]
    },
    DRAFT_CACHE_TTL
  )
}
