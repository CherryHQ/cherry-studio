import { cacheService } from '@data/CacheService'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import type { CacheAgentComposerDraft } from '@shared/data/cache/cacheValueTypes'
import type { LocalSkill } from '@shared/types/skill'

import type { ComposerSerializedDraft, ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export type AgentComposerDraftCacheKey = `agent.composer_draft.session_${string}`

export const getAgentDraftCacheKey = (sessionId: string) => `agent.composer_draft.session_${sessionId}` as const

export type AgentComposerDraftCache = CacheAgentComposerDraft

export interface RestoredAgentComposerDraftCache extends AgentComposerDraftCache {
  shouldValidateSkills: boolean
}

interface AgentDraftCacheScope {
  workspaceKey: string
  agentId: string
}

const EMPTY_DRAFT_CACHE: AgentComposerDraftCache = {
  text: '',
  tokens: [],
  files: [],
  knowledgeBaseIds: [],
  workspaceKey: '',
  agentId: ''
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

export function getAgentDraftTokens(tokens: readonly ComposerSerializedToken[]) {
  return tokens.filter((token) => isComposerInputTokenKind(token.kind))
}

export function getCacheableAgentDraft(draft: ComposerSerializedDraft): ComposerSerializedDraft {
  return {
    text: draft.text,
    tokens: getAgentDraftTokens(draft.tokens)
  }
}

export function readAgentDraftCache(
  cacheKey: AgentComposerDraftCacheKey,
  scope: AgentDraftCacheScope
): RestoredAgentComposerDraftCache {
  const cached = cacheService.get(cacheKey)
  if (!isRecord(cached)) {
    return {
      ...EMPTY_DRAFT_CACHE,
      workspaceKey: scope.workspaceKey,
      agentId: scope.agentId,
      shouldValidateSkills: false
    }
  }

  const cachedAgentId = typeof cached.agentId === 'string' ? cached.agentId : ''
  if (cachedAgentId && cachedAgentId !== scope.agentId) {
    return {
      ...EMPTY_DRAFT_CACHE,
      workspaceKey: scope.workspaceKey,
      agentId: scope.agentId,
      shouldValidateSkills: false
    }
  }

  const draft = getCacheableAgentDraft({
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : []
  })
  const cachedWorkspaceKey = typeof cached.workspaceKey === 'string' ? cached.workspaceKey : ''
  const workspaceMatches = cachedWorkspaceKey === '' || cachedWorkspaceKey === scope.workspaceKey
  const shouldValidateSkills =
    (cached.shouldValidateSkills === true || !workspaceMatches) && getCachedSkillTokens(draft.tokens).length > 0

  return {
    ...draft,
    files: Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : [],
    workspaceKey: scope.workspaceKey,
    agentId: scope.agentId,
    shouldValidateSkills
  }
}

export function writeAgentDraftCache(cacheKey: AgentComposerDraftCacheKey, draft: AgentComposerDraftCache) {
  const cacheableDraft = getCacheableAgentDraft({ text: draft.text, tokens: [...draft.tokens] })
  cacheService.set(
    cacheKey,
    {
      ...cacheableDraft,
      files: [...draft.files],
      knowledgeBaseIds: [...draft.knowledgeBaseIds],
      workspaceKey: draft.workspaceKey,
      agentId: draft.agentId,
      ...(draft.shouldValidateSkills && { shouldValidateSkills: true })
    },
    DRAFT_CACHE_TTL
  )
}
