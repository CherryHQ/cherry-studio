import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getAgentDraftCacheKey,
  getAgentDraftTokens,
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

const folderToken: ComposerSerializedToken = {
  id: 'folder:/workspace/project',
  kind: 'folder',
  label: 'project',
  promptText: '/workspace/project',
  index: 3,
  textOffset: 22
}

const linkToken: ComposerSerializedToken = {
  id: 'link-token-1',
  kind: 'link',
  label: 'example.com/docs',
  promptText: 'https://example.com/docs',
  index: 4,
  textOffset: 41
}

const legacyCommandToken: ComposerSerializedToken = {
  id: 'command:legacy',
  kind: 'command',
  label: 'Legacy command',
  index: 5,
  textOffset: 0
}

const file = { fileTokenSourceId: 'source-1', name: 'doc.pdf', path: '/workspace/doc.pdf' } as any
const scope = { workspaceKey: 'workspace-1\0/workspace', agentId: 'agent-1' }

describe('agentDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.hasCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
  })

  it('keys default drafts by session and preserves the empty-cache sentinel', () => {
    vi.mocked(cacheService.hasCasual).mockReturnValue(true)

    expect(getAgentDraftCacheKey('session-1')).toBe('agent-session-draft-session-1')
    expect(getAgentDraftCacheKey('session-2')).toBe('agent-session-draft-session-2')
    expect(hasAgentDraftCache('agent-feedback-draft-session-1')).toBe(true)
  })

  it('keeps every active input token, including file and knowledge tokens', () => {
    expect(
      getAgentDraftTokens([skillToken, knowledgeToken, fileToken, folderToken, linkToken, legacyCommandToken])
    ).toEqual([skillToken, knowledgeToken, fileToken, folderToken, linkToken])
  })

  it('round-trips a complete same-workspace draft', () => {
    const draft = {
      text: 'draft text',
      tokens: [skillToken, knowledgeToken, fileToken, folderToken, linkToken],
      files: [file],
      knowledgeBaseIds: ['kb-1'],
      ...scope
    }
    writeAgentDraftCache(getAgentDraftCacheKey('session-1'), draft)

    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    vi.mocked(cacheService.getCasual).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('session-1'), scope)).toEqual(draft)
  })

  it('does not carry a session draft across an agent change', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: 'draft for agent one',
      tokens: [skillToken],
      files: [file],
      knowledgeBaseIds: ['kb-1'],
      workspaceKey: scope.workspaceKey,
      agentId: 'agent-1'
    })

    expect(
      readAgentDraftCache(getAgentDraftCacheKey('session-1'), {
        ...scope,
        agentId: 'agent-2'
      })
    ).toEqual({
      text: '',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      workspaceKey: scope.workspaceKey,
      agentId: 'agent-2'
    })
  })

  it('drops workspace-bound files, folders, and skills when the workspace changes', () => {
    const skillPrompt = skillToken.promptText!
    const folderPrompt = folderToken.promptText!
    const linkPrompt = linkToken.promptText!
    const knowledgePrompt = knowledgeToken.promptText!
    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: `${skillPrompt} ${folderPrompt} ${linkPrompt} ${knowledgePrompt} keep this`,
      tokens: [
        { ...skillToken, index: 0, textOffset: 0 },
        { ...folderToken, index: 1, textOffset: skillPrompt.length + 1 },
        { ...linkToken, index: 2, textOffset: skillPrompt.length + folderPrompt.length + 2 },
        {
          ...knowledgeToken,
          index: 3,
          textOffset: skillPrompt.length + folderPrompt.length + linkPrompt.length + 3
        }
      ],
      files: [file],
      knowledgeBaseIds: ['kb-1'],
      workspaceKey: 'workspace-old\0/old',
      agentId: 'agent-1'
    })

    expect(readAgentDraftCache(getAgentDraftCacheKey('session-1'), scope)).toEqual({
      text: `${linkPrompt} ${knowledgePrompt} keep this`,
      tokens: [
        { ...linkToken, index: 0, textOffset: 0 },
        { ...knowledgeToken, index: 1, textOffset: linkPrompt.length + 1 }
      ],
      files: [],
      knowledgeBaseIds: ['kb-1'],
      ...scope
    })
  })

  it('keeps the skill subset available for live tool state restoration', () => {
    expect(getCachedSkillTokens([skillToken, knowledgeToken])).toEqual([skillToken])
  })
})
