import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  type ChatComposerDraftCache,
  getChatDraftCacheKey,
  hasChatDraftContent,
  readChatDraftCache,
  writeChatDraftCache
} from '../chat/chatDraftCache'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getShared: vi.fn(),
    setShared: vi.fn()
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
    vi.mocked(cacheService.getShared).mockReset()
    vi.mocked(cacheService.setShared).mockReset()
  })

  it('uses a separate cache key for each topic', () => {
    expect(getChatDraftCacheKey('topic-a')).toBe('chat.composer_draft.topic-a')
    expect(getChatDraftCacheKey('topic-b')).toBe('chat.composer_draft.topic-b')
  })

  it('reads an empty draft from a missing topic cache entry', () => {
    vi.mocked(cacheService.getShared).mockReturnValue(undefined)
    expect(readChatDraftCache('topic-a')).toEqual({
      text: '',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })
    expect(cacheService.getShared).toHaveBeenCalledWith('chat.composer_draft.topic-a')
  })

  it('degrades malformed fields independently', () => {
    vi.mocked(cacheService.getShared).mockReturnValue({
      text: 42,
      tokens: 'invalid',
      files: [file],
      knowledgeBaseIds: ['base-1', 42],
      mentionedModelIds: ['provider::model-a', 'invalid'],
      modelMultiSelectMode: 'invalid'
    } as never)

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

    expect(cacheService.setShared).toHaveBeenCalledWith('chat.composer_draft.topic-a', draft, expect.any(Number))
    const written = vi.mocked(cacheService.setShared).mock.calls[0][1]
    vi.mocked(cacheService.getShared).mockReturnValue(written)
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
