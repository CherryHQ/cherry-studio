import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import type { ComposerSerializedToken } from '../../tokens'
import {
  type ChatComposerDraftCache,
  clearChatDraftCacheIfMatches,
  getChatDraftCacheKey,
  hasChatDraftContent,
  readChatDraftCache,
  writeChatDraftCache
} from '../chat/chatDraftCache'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

const fileToken: ComposerSerializedToken = {
  id: 'file:source-1',
  kind: 'file',
  label: 'doc.pdf',
  index: 0,
  textOffset: 0
}

const knowledgeToken: ComposerSerializedToken = {
  id: 'knowledge:base-1',
  kind: 'knowledge',
  label: 'Base 1',
  promptText: 'The user attached knowledge base "Base 1" (id: base-1) — use that id with the kb_* tools.',
  index: 1,
  textOffset: 0
}

const quoteToken: ComposerSerializedToken = {
  id: 'quote-1',
  kind: 'quote',
  label: 'Quote',
  promptText: 'quoted text',
  index: 2,
  textOffset: 0
}

const file = { fileTokenSourceId: 'source-1', name: 'doc.pdf', path: '/tmp/doc.pdf' } as any

describe('chatDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.get).mockReset()
    vi.mocked(cacheService.set).mockReset()
  })

  it('uses a separate cache key for each topic', () => {
    expect(getChatDraftCacheKey('topic-a')).toBe('chat.composer_draft.topic-a')
    expect(getChatDraftCacheKey('topic-b')).toBe('chat.composer_draft.topic-b')
  })

  it('reads an empty draft from a missing topic cache entry', () => {
    vi.mocked(cacheService.get).mockReturnValue(undefined)
    expect(readChatDraftCache('topic-a')).toEqual({
      text: '',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })
    expect(cacheService.get).toHaveBeenCalledWith('chat.composer_draft.topic-a')
  })

  it('degrades malformed fields independently', () => {
    vi.mocked(cacheService.get).mockReturnValue({
      text: 42,
      tokens: 'invalid',
      files: [file],
      knowledgeBaseIds: ['base-1', 42],
      mentionedModelIds: ['provider::model-a', 'invalid'],
      modelMultiSelectMode: 'invalid'
    })

    expect(readChatDraftCache('topic-a')).toEqual({
      text: '',
      tokens: [],
      files: [file],
      knowledgeBaseIds: ['base-1'],
      mentionedModelIds: ['provider::model-a'],
      modelMultiSelectMode: false
    })
  })

  it('round-trips files, knowledge bases, and every draft token', () => {
    const draft: ChatComposerDraftCache = {
      text: 'hello world',
      tokens: [fileToken, knowledgeToken, quoteToken],
      files: [file],
      knowledgeBaseIds: ['base-1'],
      mentionedModelIds: ['provider::model-a', 'provider::model-b'],
      modelMultiSelectMode: true
    }

    writeChatDraftCache('topic-a', draft)

    expect(cacheService.set).toHaveBeenCalledWith('chat.composer_draft.topic-a', draft, expect.any(Number))
    const written = vi.mocked(cacheService.set).mock.calls[0][1]
    vi.mocked(cacheService.get).mockReturnValue(written)
    expect(readChatDraftCache('topic-a')).toEqual(draft)
  })

  it('detects editor tools and explicit model selection as draft content', () => {
    const emptyDraft: ChatComposerDraftCache = {
      text: '',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    }
    expect(hasChatDraftContent(emptyDraft)).toBe(false)
    expect(hasChatDraftContent({ ...emptyDraft, text: 'draft' })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, tokens: [quoteToken] })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, files: [file] })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, knowledgeBaseIds: ['base-1'] })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, mentionedModelIds: ['provider::model-a'] })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, modelMultiSelectMode: true })).toBe(false)
  })
})

describe('clearChatDraftCacheIfMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const submitted = {
    text: 'queued follow-up',
    tokens: [quoteToken],
    files: [],
    knowledgeBaseIds: []
  }

  it('clears the document while preserving newer model-selector fields', () => {
    // The user changed the mentioned-model selection after submitting; the
    // settlement clear must not silently revert that newer selection
    // (cherry-pr-review inv_b9cdc5f7ec400343).
    vi.mocked(cacheService.get).mockReturnValue({
      ...submitted,
      mentionedModelIds: ['provider::model-a'],
      modelMultiSelectMode: true
    })

    clearChatDraftCacheIfMatches('topic-a', submitted)

    expect(cacheService.set).toHaveBeenCalledWith(
      'chat.composer_draft.topic-a',
      {
        text: '',
        tokens: [],
        files: [],
        knowledgeBaseIds: [],
        mentionedModelIds: ['provider::model-a'],
        modelMultiSelectMode: true
      },
      expect.any(Number)
    )
  })

  it('clears to a fully empty record when model fields were untouched', () => {
    vi.mocked(cacheService.get).mockReturnValue({
      ...submitted,
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })

    clearChatDraftCacheIfMatches('topic-a', submitted)

    expect(cacheService.set).toHaveBeenCalledWith(
      'chat.composer_draft.topic-a',
      {
        text: '',
        tokens: [],
        files: [],
        knowledgeBaseIds: [],
        mentionedModelIds: [],
        modelMultiSelectMode: false
      },
      expect.any(Number)
    )
  })

  it('preserves the persisted knowledge selection when clearing the submitted document (inv_7b04aab48bb4f87e)', () => {
    vi.mocked(cacheService.get).mockReturnValue({
      ...submitted,
      knowledgeBaseIds: ['base-1'],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })

    clearChatDraftCacheIfMatches('topic-a', submitted)

    expect(cacheService.set).toHaveBeenCalledWith(
      'chat.composer_draft.topic-a',
      {
        text: '',
        tokens: [],
        files: [],
        knowledgeBaseIds: ['base-1'],
        mentionedModelIds: [],
        modelMultiSelectMode: false
      },
      expect.any(Number)
    )
  })

  it('clears the submitted document even when the knowledge selection changed after submitting', () => {
    // The knowledge selection is conversation-scoped composer state: changing
    // it must not resurrect the queued message text on the next reopen.
    vi.mocked(cacheService.get).mockReturnValue({
      ...submitted,
      knowledgeBaseIds: ['base-2'],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })

    clearChatDraftCacheIfMatches('topic-a', submitted)

    expect(cacheService.set).toHaveBeenCalledWith(
      'chat.composer_draft.topic-a',
      {
        text: '',
        tokens: [],
        files: [],
        knowledgeBaseIds: ['base-2'],
        mentionedModelIds: [],
        modelMultiSelectMode: false
      },
      expect.any(Number)
    )
  })

  it('preserves the whole record when newer document edits diverge', () => {
    const edited = {
      text: 'edited after submit',
      tokens: [quoteToken],
      files: [],
      knowledgeBaseIds: [],
      mentionedModelIds: ['provider::model-a'],
      modelMultiSelectMode: true
    }
    vi.mocked(cacheService.get).mockReturnValue(edited)

    clearChatDraftCacheIfMatches('topic-a', submitted)

    expect(cacheService.set).not.toHaveBeenCalled()
  })
})
