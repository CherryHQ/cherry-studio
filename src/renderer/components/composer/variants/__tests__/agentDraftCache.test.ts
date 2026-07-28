import { cacheService } from '@data/CacheService'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getAgentDraftCacheKey,
  getCachedKnowledgeBases,
  getCachedSkillTokens,
  readAgentDraftCache,
  writeAgentDraftCache
} from '../agent/agentDraftCache'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(),
    setCasual: vi.fn()
  }
}))

const base = { id: 'kb-1', name: 'Notes' } as KnowledgeBase

const skillToken: ComposerSerializedToken = {
  id: 'skill:review',
  kind: 'skill',
  label: 'Review',
  promptText: 'Use the Review skill.',
  payload: { name: 'Review', filename: 'review' },
  index: 0,
  textOffset: 0
}

const knowledgeToken: ComposerSerializedToken = {
  id: 'knowledge:kb-1',
  kind: 'knowledge',
  label: 'Notes',
  promptText: 'The user attached knowledge base "Notes" (id: kb-1) — use that id with the kb_* tools.',
  payload: base,
  index: 1,
  textOffset: 22
}

const fileToken: ComposerSerializedToken = {
  id: 'file:source-1',
  kind: 'file',
  label: 'doc.pdf',
  index: 2,
  textOffset: 0
}

describe('agentDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
  })

  it('round-trips knowledge tokens so their prompt text keeps its chip', () => {
    // Dropping the token while persisting the text would strand the sentence as chip-less prose that
    // tells the model a base is attached while the send path scopes nothing.
    writeAgentDraftCache(getAgentDraftCacheKey('agent-1'), 'text', [skillToken, knowledgeToken, fileToken])

    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    expect(written).toEqual({ text: 'text', tokens: [skillToken, knowledgeToken] })

    vi.mocked(cacheService.getCasual).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('agent-1')).tokens).toEqual([skillToken, knowledgeToken])
  })

  it('rebuilds the knowledge selection from the cached token payload', () => {
    // Read synchronously at mount, so it must not depend on the knowledge-base query having resolved.
    const text = `prefix ${knowledgeToken.promptText}`
    expect(
      getCachedKnowledgeBases({ text, tokens: [skillToken, { ...knowledgeToken, textOffset: 7 }, fileToken] })
    ).toEqual([base])
  })

  it('ignores a knowledge token whose sentence is no longer at its offset', () => {
    // A managed-token strip suppresses onTokensChange but still fires onTextChange, so the cache can
    // hold a token naming a chip whose sentence is already gone. Re-seeding from it would resurrect a
    // pick the user watched disappear.
    expect(getCachedKnowledgeBases({ text: 'the sentence was edited away', tokens: [knowledgeToken] })).toEqual([])
  })

  it('keeps the skill subset separate from the persisted token set', () => {
    expect(getCachedSkillTokens([skillToken, knowledgeToken])).toEqual([skillToken])
  })

  it('ignores a knowledge token whose payload is not a knowledge base', () => {
    const text = `prefix ${knowledgeToken.promptText}`
    expect(getCachedKnowledgeBases({ text, tokens: [{ ...knowledgeToken, textOffset: 7, payload: 'nope' }] })).toEqual(
      []
    )
  })
})
