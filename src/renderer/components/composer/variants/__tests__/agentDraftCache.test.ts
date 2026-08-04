import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getAgentDraftCacheKey,
  getAgentDraftTokens,
  getCacheableAgentDraft,
  getCachedSkillTokens,
  hasAgentDraftCache,
  readAgentDraftCache,
  writeAgentDraftCache
} from '../agent/agentDraftCache'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(),
    hasCasual: vi.fn(),
    setCasual: vi.fn()
  }
}))

const base = { id: 'kb-1', name: 'Notes' }

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
    vi.mocked(cacheService.hasCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
  })

  it('distinguishes an intentionally empty cached draft from a missing draft', () => {
    vi.mocked(cacheService.hasCasual).mockReturnValue(true)

    expect(hasAgentDraftCache('agent-feedback-draft-session-1')).toBe(true)
    expect(cacheService.hasCasual).toHaveBeenCalledWith('agent-feedback-draft-session-1')
  })

  it('keeps every active non-file input token in the live Agent draft', () => {
    expect(
      getAgentDraftTokens([
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
    ).toEqual([skillToken, knowledgeToken, linkToken, folderToken, referenceToken, quoteToken, promptVariableToken])
  })

  it('round-trips every agent-cacheable input token so its prompt text keeps its chip', () => {
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
      { ...linkToken, index: 2 },
      { ...folderToken, index: 3 },
      { ...referenceToken, index: 4 },
      { ...quoteToken, index: 5 },
      { ...promptVariableToken, index: 6 }
    ]
    expect(written).toEqual({ text: 'text', tokens: expectedTokens })

    vi.mocked(cacheService.getCasual).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('agent-1')).tokens).toEqual(expectedTokens)
  })

  it('drops a knowledge token together with its prompt while preserving and rebasing a skill token', () => {
    const knowledgeFirst = { ...knowledgeToken, index: 0, textOffset: 0 }
    const skillAfterKnowledge = {
      ...skillToken,
      index: 1,
      textOffset: knowledgeToken.promptText!.length + 1
    }
    const text = `${knowledgeToken.promptText} ${skillToken.promptText} keep this`

    expect(getCacheableAgentDraft({ text, tokens: [knowledgeFirst, skillAfterKnowledge, fileToken] })).toEqual({
      text: `${skillToken.promptText} keep this`,
      tokens: [{ ...skillToken, index: 0, textOffset: 0 }]
    })
  })

  it('excises knowledge tokens on both cache writes and reads', () => {
    const text = `${knowledgeToken.promptText} keep this`
    const token = { ...knowledgeToken, index: 0, textOffset: 0 }

    writeAgentDraftCache(getAgentDraftCacheKey('agent-1'), text, [token, skillToken])

    expect(cacheService.setCasual).toHaveBeenCalledWith(
      'agent-session-draft-agent-1',
      { text: 'keep this', tokens: [{ ...skillToken, index: 0, textOffset: 0 }] },
      expect.any(Number)
    )

    vi.mocked(cacheService.getCasual).mockReturnValue({ text, tokens: [token, skillToken] })
    expect(readAgentDraftCache(getAgentDraftCacheKey('agent-1'))).toEqual({
      text: 'keep this',
      tokens: [{ ...skillToken, index: 0, textOffset: 0 }]
    })
  })

  it('collapses a knowledge-only draft to empty', () => {
    expect(
      getCacheableAgentDraft({
        text: `${knowledgeToken.promptText} `,
        tokens: [{ ...knowledgeToken, index: 0, textOffset: 0 }]
      })
    ).toEqual({ text: '', tokens: [] })
  })

  it('keeps the skill subset separate from the persisted token set', () => {
    expect(getCachedSkillTokens([skillToken, knowledgeToken])).toEqual([skillToken])
  })
})
