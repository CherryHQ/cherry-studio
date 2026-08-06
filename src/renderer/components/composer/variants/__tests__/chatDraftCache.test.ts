import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import { getChatDraftCacheKey, readChatDraftCache, writeChatDraftCache } from '../chat/chatDraftCache'

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(),
    setCasual: vi.fn()
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
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.setCasual).mockReset()
  })

  it('uses a separate cache key for each topic', () => {
    expect(getChatDraftCacheKey('topic-a')).toBe('chat-topic-draft-topic-a')
    expect(getChatDraftCacheKey('topic-b')).toBe('chat-topic-draft-topic-b')
  })

  it('reads a scoped legacy string as a text-only draft', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue('legacy draft')

    expect(readChatDraftCache('topic-a')).toEqual({
      text: 'legacy draft',
      tokens: [],
      files: [],
      knowledgeBaseIds: []
    })
    expect(cacheService.getCasual).toHaveBeenCalledWith('chat-topic-draft-topic-a')
  })

  it('degrades malformed fields independently', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: 42,
      tokens: 'invalid',
      files: [file],
      knowledgeBaseIds: ['base-1', 42]
    })

    expect(readChatDraftCache('topic-a')).toEqual({
      text: '',
      tokens: [],
      files: [file],
      knowledgeBaseIds: ['base-1']
    })
  })

  it('round-trips files, knowledge bases, and every draft token', () => {
    const draft = {
      text: 'hello world',
      tokens: [fileToken, knowledgeToken, quoteToken],
      files: [file],
      knowledgeBaseIds: ['base-1']
    }

    writeChatDraftCache('topic-a', draft)

    expect(cacheService.setCasual).toHaveBeenCalledWith('chat-topic-draft-topic-a', draft, expect.any(Number))
    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    vi.mocked(cacheService.getCasual).mockReturnValue(written)
    expect(readChatDraftCache('topic-a')).toEqual(draft)
  })
})
