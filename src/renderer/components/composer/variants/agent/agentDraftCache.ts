import { cacheService } from '@data/CacheService'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { LocalSkill } from '@shared/types/skill'

import type { ComposerSerializedToken } from '../../tokens'

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

function isKnowledgeBase(value: unknown): value is KnowledgeBase {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

/**
 * Rebuilds the knowledge selection a cached draft's chips stand for, mirroring
 * `getSkillFromCachedToken`. Read synchronously at mount rather than mapped through the
 * knowledge-base query, so the pick exists before the surface's managed-token sync would strip a
 * restored chip as unselected.
 *
 * A token whose sentence is no longer at its recorded offset is stale and must not seed anything: a
 * managed-token strip suppresses `onTokensChange` but still fires `onTextChange`, so the draft can be
 * persisted with the sentence already gone while the token list still names the chip. Re-seeding from
 * that would resurrect a pick the user watched disappear, and `createComposerDocumentContent` refuses
 * to rebuild the chip at the stale offset anyway, so the sentence would land wherever the caret is.
 */
export function getCachedKnowledgeBases(draft: AgentComposerDraftCache): KnowledgeBase[] {
  return draft.tokens.flatMap((token) =>
    token.kind === 'knowledge' &&
    isKnowledgeBase(token.payload) &&
    (!token.promptText || draft.text.startsWith(token.promptText, token.textOffset))
      ? [token.payload]
      : []
  )
}

/**
 * The token kinds that ride the cached draft. All fold a `promptText` into the draft text, so
 * persisting the text while dropping the token would strand that sentence as chip-less prose —
 * for a knowledge pick, prose telling the model a base is attached that nothing scopes.
 */
export function getCacheableDraftTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => token.kind === 'skill' || token.kind === 'knowledge' || token.kind === 'link')
}

export function readAgentDraftCache(cacheKey: string): AgentComposerDraftCache {
  const cached = cacheService.getCasual<string | AgentComposerDraftCache>(cacheKey)
  if (typeof cached === 'string') return { text: cached, tokens: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return { text: '', tokens: [] }
  }

  return {
    text: cached.text,
    tokens: getCacheableDraftTokens(cached.tokens)
  }
}

export function writeAgentDraftCache(cacheKey: string, text: string, tokens: readonly ComposerSerializedToken[]) {
  cacheService.setCasual<AgentComposerDraftCache>(
    cacheKey,
    {
      text,
      tokens: getCacheableDraftTokens(tokens)
    },
    DRAFT_CACHE_TTL
  )
}
