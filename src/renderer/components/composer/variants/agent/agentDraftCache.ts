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

/**
 * Clear the cached draft only when it still matches the draft that was just
 * enqueued, and report whether the entry matched. An unmount between submit
 * and settlement persists the submitted draft, and a reopened composer keeps
 * editing it: clearing through the obsolete instance would overwrite the
 * newer cached draft with empty content (cherry-pr-review
 * inv_e49e883e1e3d4bb6). A mismatch is preserved untouched.
 *
 * Only the submitted document fields participate in the match. The scope
 * fields (workspaceKey, agentId) survive the reset, like the model-selector
 * fields in the chat variant.
 */
export function clearAgentDraftCacheIfMatches(
  cacheKey: AgentComposerDraftCacheKey,
  scope: AgentDraftCacheScope,
  submitted: Pick<AgentComposerDraftCache, 'text' | 'tokens' | 'files'>
): boolean {
  // Inspect raw cached ownership before the scoped read: readAgentDraftCache
  // masks another agent's entry as an empty draft, which would read as
  // "nothing to preserve" and let this stale settlement overwrite that
  // owner's newer content with an empty entry under the wrong agent
  // (cherry-pr-review inv_2905e46649d25a44).
  const raw = cacheService.get(cacheKey)
  if (isRecord(raw)) {
    const rawAgentId = typeof raw.agentId === 'string' ? raw.agentId : ''
    const rawWorkspaceKey = typeof raw.workspaceKey === 'string' ? raw.workspaceKey : ''
    if (
      (rawAgentId !== '' && rawAgentId !== scope.agentId) ||
      (rawWorkspaceKey !== '' && rawWorkspaceKey !== scope.workspaceKey)
    ) {
      return false
    }
  }
  const cached = readAgentDraftCache(cacheKey, scope)
  // Only a real cached document can belong to a newer owner: an empty entry
  // (persistence disabled or nothing persisted yet) carries nothing to
  // preserve and must not block the settlement clear.
  const hasDocument = cached.text !== '' || cached.tokens.length > 0 || cached.files.length > 0
  if (hasDocument) {
    if (cached.text !== submitted.text) return false
    if (JSON.stringify(cached.tokens) !== JSON.stringify(submitted.tokens)) return false
    if (JSON.stringify(cached.files) !== JSON.stringify(submitted.files)) return false
  }
  // The knowledge selection is conversation-scoped state the user may have
  // changed after submitting: it neither participates in the match nor is
  // reset (cherry-pr-review inv_7b04aab48bb4f87e).
  writeAgentDraftCache(cacheKey, {
    ...EMPTY_DRAFT_CACHE,
    knowledgeBaseIds: cached.knowledgeBaseIds,
    workspaceKey: scope.workspaceKey,
    agentId: scope.agentId
  })
  return true
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
