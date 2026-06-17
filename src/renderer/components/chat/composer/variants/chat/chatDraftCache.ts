import { cacheService } from '@data/CacheService'
import type { FileMetadata } from '@renderer/types'

import type { ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'

export interface ChatComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
  files: FileMetadata[]
}

const EMPTY_DRAFT_CACHE: ChatComposerDraftCache = { text: '', tokens: [], files: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isComposerSerializedToken(value: unknown): value is ComposerSerializedToken {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.label === 'string' &&
    typeof value.index === 'number' &&
    typeof value.textOffset === 'number'
  )
}

function isFileMetadata(value: unknown): value is FileMetadata {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
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
    tokens: getCacheableDraftTokens(cached.tokens.filter(isComposerSerializedToken)),
    files: Array.isArray(cached.files) ? cached.files.filter(isFileMetadata) : []
  }
}

export function writeChatDraftCache(
  text: string,
  tokens: readonly ComposerSerializedToken[],
  files: readonly FileMetadata[]
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
