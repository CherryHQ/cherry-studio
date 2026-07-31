import { cacheService } from '@data/CacheService'

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import { excludeComposerDraftTokens } from '../../composerDraft'
import type { ComposerSerializedDraft, ComposerSerializedToken } from '../../tokens'

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
// tokens must not follow this cache, which is a single global key. The sentence such a token folded
// into the text goes with it — left behind it would restore as chip-less prose claiming a base is
// attached, while the send path derives the scope from the (now absent) token and attaches nothing.
export function getCacheableDraft(draft: ComposerSerializedDraft): ComposerSerializedDraft {
  return excludeComposerDraftTokens(draft, (token) => token.kind === 'knowledge')
}

export function readChatDraftCache(): ChatComposerDraftCache {
  const cached = cacheService.getCasual<string | ChatComposerDraftCache>(INPUTBAR_DRAFT_CACHE_KEY)
  if (typeof cached === 'string') return { text: cached, tokens: [], files: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return EMPTY_DRAFT_CACHE
  }

  const draft = getCacheableDraft({ text: cached.text, tokens: cached.tokens })
  return {
    ...draft,
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
      ...getCacheableDraft({ text, tokens: [...tokens] }),
      files: [...files]
    },
    DRAFT_CACHE_TTL
  )
}
