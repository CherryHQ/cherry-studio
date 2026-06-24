import { cacheService } from '@data/CacheService'
import type { LocalSkill } from '@renderer/types'

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

export function readAgentDraftCache(cacheKey: string): AgentComposerDraftCache {
  const cached = cacheService.getCasual<string | AgentComposerDraftCache>(cacheKey)
  if (typeof cached === 'string') return { text: cached, tokens: [] }
  if (!isRecord(cached) || typeof cached.text !== 'string' || !Array.isArray(cached.tokens)) {
    return { text: '', tokens: [] }
  }

  return {
    text: cached.text,
    tokens: getCachedSkillTokens(cached.tokens)
  }
}

export function writeAgentDraftCache(cacheKey: string, text: string, tokens: readonly ComposerSerializedToken[]) {
  cacheService.setCasual<AgentComposerDraftCache>(
    cacheKey,
    {
      text,
      tokens: getCachedSkillTokens(tokens)
    },
    DRAFT_CACHE_TTL
  )
}
