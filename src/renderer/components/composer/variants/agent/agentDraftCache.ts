import { cacheService } from '@data/CacheService'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { LocalSkill } from '@shared/types/skill'

import { excludeComposerDraftTokens } from '../../composerDraft'
import type { ComposerSerializedDraft, ComposerSerializedToken } from '../../tokens'

const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000

export const AGENT_HOME_DRAFT_CACHE_KEY = 'agent-home-draft'
export const getAgentDraftCacheKey = (sessionId: string) => `agent-session-draft-${sessionId}`

export interface AgentComposerDraftCache {
  text: string
  tokens: ComposerSerializedToken[]
  files: ComposerAttachment[]
  knowledgeBaseIds: string[]
  workspaceKey: string
  agentId: string
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

function downgradeWorkspaceDraft(draft: ComposerSerializedDraft): ComposerSerializedDraft {
  return excludeComposerDraftTokens(
    draft,
    (token) => token.kind === 'file' || token.kind === 'folder' || token.kind === 'skill'
  )
}

export function readAgentDraftCache(cacheKey: string, scope: AgentDraftCacheScope): AgentComposerDraftCache {
  const cached = cacheService.getCasual<string | AgentComposerDraftCache>(cacheKey)
  if (typeof cached === 'string') {
    return { ...EMPTY_DRAFT_CACHE, text: cached, workspaceKey: scope.workspaceKey, agentId: scope.agentId }
  }
  if (!isRecord(cached)) return { ...EMPTY_DRAFT_CACHE, workspaceKey: scope.workspaceKey, agentId: scope.agentId }

  const cachedAgentId = typeof cached.agentId === 'string' ? cached.agentId : ''
  if (cachedAgentId && cachedAgentId !== scope.agentId) {
    return { ...EMPTY_DRAFT_CACHE, workspaceKey: scope.workspaceKey, agentId: scope.agentId }
  }

  const draft = getCacheableAgentDraft({
    text: typeof cached.text === 'string' ? cached.text : '',
    tokens: Array.isArray(cached.tokens) ? cached.tokens : []
  })
  const cachedWorkspaceKey = typeof cached.workspaceKey === 'string' ? cached.workspaceKey : ''
  const workspaceMatches = cachedWorkspaceKey === '' || cachedWorkspaceKey === scope.workspaceKey
  const restoredDraft = workspaceMatches ? draft : downgradeWorkspaceDraft(draft)

  return {
    ...restoredDraft,
    files: workspaceMatches && Array.isArray(cached.files) ? cached.files : [],
    knowledgeBaseIds: Array.isArray(cached.knowledgeBaseIds)
      ? cached.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
      : [],
    workspaceKey: scope.workspaceKey,
    agentId: scope.agentId
  }
}

export function hasAgentDraftCache(cacheKey: string): boolean {
  return cacheService.hasCasual(cacheKey)
}

export function writeAgentDraftCache(cacheKey: string, draft: AgentComposerDraftCache) {
  const cacheableDraft = getCacheableAgentDraft({ text: draft.text, tokens: [...draft.tokens] })
  cacheService.setCasual<AgentComposerDraftCache>(
    cacheKey,
    {
      ...cacheableDraft,
      files: [...draft.files],
      knowledgeBaseIds: [...draft.knowledgeBaseIds],
      workspaceKey: draft.workspaceKey,
      agentId: draft.agentId
    },
    DRAFT_CACHE_TTL
  )
}
