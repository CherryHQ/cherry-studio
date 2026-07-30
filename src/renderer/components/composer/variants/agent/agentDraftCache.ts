import { cacheService } from '@data/CacheService'
import type { LocalSkill } from '@shared/types/skill'

import { excludeComposerDraftTokens } from '../../composerDraft'
import type { ComposerSerializedDraft, ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const getAgentDraftCacheKey = (agentId: string) => `agent-session-draft-${agentId}`

export interface AgentComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLocalSkill(value: unknown): value is LocalSkill {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.filename === 'string' &&
    (value.description === undefined || typeof value.description === 'string')
  )
}

function getSkillFilenameFromToken(token: ComposerSerializedToken): string {
  return token.id.startsWith('skill:') ? token.id.slice('skill:'.length) : token.label
}

export function getSkillFromCachedToken(token: ComposerSerializedToken): LocalSkill {
  if (isLocalSkill(token.payload)) return token.payload

  return {
    name: token.label,
    ...(token.description && { description: token.description }),
    filename: getSkillFilenameFromToken(token)
  }
}

export function getCachedSkillTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => token.kind === 'skill')
}

/**
 * Token kinds retained in the live Agent composer draft. Knowledge remains here so the current
 * session can serialize and edit its chip; the persistence boundary below removes it.
 */
export function getAgentManagedDraftTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => token.kind === 'skill' || token.kind === 'knowledge')
}

/** Knowledge selection is session-scoped, while this cache is agent-scoped. */
export function getCacheableAgentDraft(draft: ComposerSerializedDraft): AgentComposerDraftCache {
  const withoutKnowledge = excludeComposerDraftTokens(draft, (token) => token.kind === 'knowledge')
  return {
    text: withoutKnowledge.text,
    tokens: getCachedSkillTokens(withoutKnowledge.tokens)
  }
}

export function readAgentDraftCache(cacheKey: string): AgentComposerDraftCache {
  const cached = cacheService.getCasual<string | AgentComposerDraftCache>(cacheKey)
  if (typeof cached === 'string') return { text: cached, tokens: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return { text: '', tokens: [] }
  }

  return getCacheableAgentDraft({ text: cached.text, tokens: cached.tokens })
}

export function writeAgentDraftCache(cacheKey: string, text: string, tokens: readonly ComposerSerializedToken[]) {
  const cacheableDraft = getCacheableAgentDraft({ text, tokens: [...tokens] })
  cacheService.setCasual<AgentComposerDraftCache>(cacheKey, cacheableDraft, DRAFT_CACHE_TTL)
}
