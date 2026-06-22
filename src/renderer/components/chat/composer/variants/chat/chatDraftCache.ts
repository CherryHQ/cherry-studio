import { cacheService } from '@data/CacheService'
import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'

import type { ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

// v2 writes a structured draft, so it must NOT reuse v1's `'inputbar-draft'` key
// (the live v1 Inputbar reads that as a bare string and would render `[object
// Object]`). v2 owns this key; the legacy v1 string is migrated on read below.
export const CHAT_COMPOSER_DRAFT_CACHE_KEY = 'v2-chat-composer-draft'
export const LEGACY_INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'

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
  const cached = cacheService.getCasual<ChatComposerDraftCache>(CHAT_COMPOSER_DRAFT_CACHE_KEY)
  if (isRecord(cached) && typeof cached.text === 'string' && Array.isArray(cached.tokens)) {
    return {
      text: cached.text,
      tokens: getCacheableDraftTokens(cached.tokens),
      files: Array.isArray(cached.files) ? cached.files : []
    }
  }

  // Migrate the legacy v1 string draft (one-time, on first v2 read).
  const legacy = cacheService.getCasual<string>(LEGACY_INPUTBAR_DRAFT_CACHE_KEY)
  if (typeof legacy === 'string' && legacy.length > 0) return { text: legacy, tokens: [], files: [] }

  return EMPTY_DRAFT_CACHE
}

export function writeChatDraftCache(
  text: string,
  tokens: readonly ComposerSerializedToken[],
  files: readonly ComposerAttachment[]
) {
  cacheService.setCasual<ChatComposerDraftCache>(
    CHAT_COMPOSER_DRAFT_CACHE_KEY,
    {
      text,
      tokens: getCacheableDraftTokens(tokens),
      files: [...files]
    },
    DRAFT_CACHE_TTL
  )
}
