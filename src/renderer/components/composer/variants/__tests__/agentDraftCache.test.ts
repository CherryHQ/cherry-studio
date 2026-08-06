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
    get: vi.fn(),
    has: vi.fn(),
    set: vi.fn()
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
    vi.mocked(cacheService.get).mockReset()
    vi.mocked(cacheService.has).mockReset()
    vi.mocked(cacheService.set).mockReset()
  })

  it('keys default drafts by session and preserves the empty-cache sentinel', () => {
    vi.mocked(cacheService.has).mockReturnValue(true)

    expect(getAgentDraftCacheKey('session-1')).toBe('agent.composer_draft.session_session-1')
    expect(getAgentDraftCacheKey('session-2')).toBe('agent.composer_draft.session_session-2')
    expect(hasAgentDraftCache('agent.composer_draft.feedback_session-1')).toBe(true)
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

    const written = vi.mocked(cacheService.set).mock.calls[0][1]
    vi.mocked(cacheService.get).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('session-1'), scope)).toEqual({
      ...draft,
      shouldValidateSkills: false
    })
  })

  it('does not carry a session draft across an agent change', () => {
    vi.mocked(cacheService.get).mockReturnValue({
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
      agentId: 'agent-2',
      shouldValidateSkills: false
    })
  })

  it('preserves absolute-path files and resource tokens while deferring skill validation after a workspace change', () => {
    const skillPrompt = skillToken.promptText!
    const folderPrompt = folderToken.promptText!
    const linkPrompt = linkToken.promptText!
    const knowledgePrompt = knowledgeToken.promptText!
    vi.mocked(cacheService.get).mockReturnValue({
      text: `${skillPrompt} ${folderPrompt} ${linkPrompt} ${knowledgePrompt} keep this`,
      tokens: [
        { ...skillToken, index: 0, textOffset: 0 },
        { ...folderToken, index: 1, textOffset: skillPrompt.length + 1 },
        { ...linkToken, index: 2, textOffset: skillPrompt.length + folderPrompt.length + 2 },
        {
          ...knowledgeToken,
          index: 3,
          textOffset: skillPrompt.length + folderPrompt.length + linkPrompt.length + 3
        },
        { ...fileToken, index: 4, textOffset: 0 }
      ],
      files: [file],
      knowledgeBaseIds: ['kb-1'],
      workspaceKey: 'workspace-old\0/old',
      agentId: 'agent-1'
    })

    expect(readAgentDraftCache(getAgentDraftCacheKey('session-1'), scope)).toEqual({
      text: `${skillPrompt} ${folderPrompt} ${linkPrompt} ${knowledgePrompt} keep this`,
      tokens: [
        { ...skillToken, index: 0, textOffset: 0 },
        { ...folderToken, index: 1, textOffset: skillPrompt.length + 1 },
        { ...linkToken, index: 2, textOffset: skillPrompt.length + folderPrompt.length + 2 },
        {
          ...knowledgeToken,
          index: 3,
          textOffset: skillPrompt.length + folderPrompt.length + linkPrompt.length + 3
        },
        { ...fileToken, index: 4, textOffset: 0 }
      ],
      files: [file],
      knowledgeBaseIds: ['kb-1'],
      ...scope,
      shouldValidateSkills: true
    })
  })

  it('keeps the skill subset available for live tool state restoration', () => {
    expect(getCachedSkillTokens([skillToken, knowledgeToken])).toEqual([skillToken])
  })

  it('persists pending workspace skill validation until a later restore can retry it', () => {
    writeAgentDraftCache(getAgentDraftCacheKey('session-1'), {
      text: skillToken.promptText!,
      tokens: [skillToken],
      files: [file],
      knowledgeBaseIds: [],
      ...scope,
      shouldValidateSkills: true
    })

    const written = vi.mocked(cacheService.set).mock.calls[0][1]
    expect(written).toEqual(expect.objectContaining({ shouldValidateSkills: true }))
    vi.mocked(cacheService.get).mockReturnValue(written)
    expect(readAgentDraftCache(getAgentDraftCacheKey('session-1'), scope).shouldValidateSkills).toBe(true)
  })
})
