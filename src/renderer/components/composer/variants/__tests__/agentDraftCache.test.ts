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

const linkToken: ComposerSerializedToken = {
  id: 'link-token-1',
  kind: 'link',
  label: 'example.com/docs',
  promptText: 'https://example.com/docs',
  index: 3,
  textOffset: 0
}

const folderToken: ComposerSerializedToken = {
  id: 'folder:/tmp/project',
  kind: 'folder',
  label: 'project',
  promptText: '/tmp/project',
  index: 4,
  textOffset: 0
}

const referenceToken: ComposerSerializedToken = {
  id: 'reference:session:1',
  kind: 'reference',
  label: 'Related session',
  promptText: '<referenced-conversation>content</referenced-conversation>',
  index: 5,
  textOffset: 0
}

const quoteToken: ComposerSerializedToken = {
  id: 'quote:1',
  kind: 'quote',
  label: 'Quote',
  promptText: 'quoted text',
  index: 6,
  textOffset: 0
}

const promptVariableToken: ComposerSerializedToken = {
  id: 'prompt-variable:0:city',
  kind: 'promptVariable',
  label: '上海',
  promptText: '上海',
  index: 7,
  textOffset: 0
}

const legacyCommandToken: ComposerSerializedToken = {
  id: 'command:legacy',
  kind: 'command',
  label: 'Legacy command',
  index: 8,
  textOffset: 0
}

describe('agentDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
  })

  it('round-trips every active non-file input token so its prompt text keeps its chip', () => {
    writeAgentDraftCache(getAgentDraftCacheKey('agent-1'), 'text', [
      skillToken,
      knowledgeToken,
      fileToken,
      linkToken,
      folderToken,
      referenceToken,
      quoteToken,
      promptVariableToken,
      legacyCommandToken
    ])

    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    const expectedTokens = [
      skillToken,
      knowledgeToken,
      linkToken,
      folderToken,
      referenceToken,
      quoteToken,
      promptVariableToken
    ]
    expect(written).toEqual({ text: 'text', tokens: expectedTokens })

    vi.mocked(cacheService.getCasual).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('agent-1')).tokens).toEqual(expectedTokens)
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
