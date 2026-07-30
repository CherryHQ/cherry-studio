import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getAgentDraftCacheKey,
  getCacheableAgentDraft,
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

describe('agentDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
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
