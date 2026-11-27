import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serializeComposerDocument } from '../../composerDraft'
import { getComposerPlainTextPasteOverride } from '../../composerPaste'
import type { ComposerSerializedToken } from '../../tokens'
import {
  type ChatComposerDraftCache,
  clearSubmittedChatDraftCache,
  getChatDraftCacheKey,
  hasChatDraftContent,
  readChatDraftCache,
  writeChatDraftCache
} from '../chat/chatDraftCache'

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
    MockCacheUtils.resetMocks()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads an empty draft from a missing topic cache entry', () => {
    expect(readChatDraftCache('topic-a')).toEqual({
      text: '',
      tokens: [],
      files: [],
      knowledgeBaseIds: [],
      mentionedModelIds: [],
      modelMultiSelectMode: false
    })
  })

  it('degrades malformed fields independently', () => {
    MockCacheUtils.setInitialState({
      memory: [
        [
          'chat.composer_draft.topic-a',
          {
            text: 42,
            tokens: 'invalid',
            files: [file],
            knowledgeBaseIds: ['base-1', 42],
            mentionedModelIds: ['provider::model-a', 'invalid'],
            modelMultiSelectMode: 'invalid'
          }
        ]
      ]
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

    expect(readChatDraftCache('topic-a')).toEqual(draft)
  })

  it('restores typed text per topic after the renderer cache is recreated', () => {
    const empty = readChatDraftCache('topic-a')
    writeChatDraftCache('topic-a', { ...empty, text: 'First topic\nDraft' })
    writeChatDraftCache('topic-b', { ...empty, text: 'Second topic' })

    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a').text).toBe('First topic\nDraft')
    expect(readChatDraftCache('topic-b').text).toBe('Second topic')
    expect(readChatDraftCache('topic-c').text).toBe('')
  })

  it('does not resurrect a cleared draft when the renderer cache is recreated', () => {
    const empty = readChatDraftCache('topic-a')
    writeChatDraftCache('topic-a', { ...empty, text: 'Previous draft' })
    writeChatDraftCache('topic-a', empty)

    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a')).toEqual(empty)
    expect(sessionStorage.getItem(getChatDraftCacheKey('topic-a'))).toBeNull()
  })

  it('does not restore text after the existing 24-hour deadline', () => {
    vi.useFakeTimers()
    const empty = readChatDraftCache('topic-a')
    writeChatDraftCache('topic-a', { ...empty, text: 'Expired draft' })

    MockCacheUtils.resetMocks()
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1)

    expect(readChatDraftCache('topic-a')).toEqual(empty)
  })

  it('recovers typed text without turning a token’s prompt into user input', () => {
    const empty = readChatDraftCache('topic-a')
    writeChatDraftCache('topic-a', {
      ...empty,
      text: 'quoted text My reply',
      tokens: [{ ...quoteToken, textOffset: 0 }]
    })

    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a')).toEqual({ ...empty, text: 'My reply' })
  })

  it('recovers a standalone pasted URL as text without its token metadata', () => {
    const empty = readChatDraftCache('topic-a')
    const url = 'https://example.com/article'
    const content = getComposerPlainTextPasteOverride(url, {})!
    const draft = serializeComposerDocument({ type: 'doc', content: [{ type: 'paragraph', content }] })
    writeChatDraftCache('topic-a', { ...empty, ...draft })

    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a')).toEqual({ ...empty, text: url })
    expect(JSON.parse(sessionStorage.getItem(getChatDraftCacheKey('topic-a'))!)).toEqual({
      text: url,
      expiresAt: expect.any(Number)
    })
  })

  it('recovers filled variable text while omitting quote and tool prompts', () => {
    const empty = readChatDraftCache('topic-a')
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'composerToken', attrs: quoteToken },
            { type: 'text', text: ' Route from ' },
            {
              type: 'composerToken',
              attrs: {
                id: 'prompt-variable:from',
                kind: 'promptVariable',
                label: 'from',
                promptText: 'Shanghai',
                payload: { variableName: 'from', raw: '${from}' }
              }
            },
            { type: 'text', text: ' to Beijing ' },
            { type: 'composerToken', attrs: knowledgeToken }
          ]
        }
      ]
    })
    writeChatDraftCache('topic-a', { ...empty, ...draft })

    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a')).toEqual({ ...empty, text: 'Route from Shanghai to Beijing ' })
  })

  it('reclaims expired draft entries before saving within the storage quota', () => {
    const empty = readChatDraftCache('topic-a')
    const expiredKey = getChatDraftCacheKey('expired-topic')
    const otherKey = 'another-feature'
    const validKey = getChatDraftCacheKey('valid-topic')
    sessionStorage.setItem(expiredKey, JSON.stringify({ text: 'expired'.repeat(100), expiresAt: Date.now() - 1 }))
    sessionStorage.setItem(otherKey, JSON.stringify({ text: 'other', expiresAt: Date.now() - 1 }))
    sessionStorage.setItem(validKey, JSON.stringify({ text: 'Keep this draft', expiresAt: Date.now() + 60000 }))
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this.getItem(expiredKey)) throw new DOMException('Storage is full', 'QuotaExceededError')
      setItem.call(this, key, value)
    })

    writeChatDraftCache('topic-a', { ...empty, text: 'Current draft' })
    MockCacheUtils.resetMocks()

    expect(readChatDraftCache('topic-a').text).toBe('Current draft')
    expect(sessionStorage.getItem(expiredKey)).toBeNull()
    expect(sessionStorage.getItem(otherKey)).not.toBeNull()
    expect(readChatDraftCache('valid-topic').text).toBe('Keep this draft')
  })

  it('preserves a newer token selection even when its submitted text is unchanged', () => {
    const empty = readChatDraftCache('topic-a')
    const submitted = { text: 'My reply', tokens: [fileToken] }
    const updated = {
      ...empty,
      ...submitted,
      tokens: [fileToken, knowledgeToken],
      files: [file],
      knowledgeBaseIds: ['base-1']
    }
    writeChatDraftCache('topic-a', updated)

    clearSubmittedChatDraftCache('topic-a', submitted)

    expect(readChatDraftCache('topic-a')).toEqual(updated)
    MockCacheUtils.resetMocks()
    expect(readChatDraftCache('topic-a').text).toBe('My reply')
  })

  it('keeps the live draft and discards the older recovery copy if storage is full', () => {
    const empty = readChatDraftCache('topic-a')
    writeChatDraftCache('topic-a', { ...empty, text: 'Previous draft' })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })

    writeChatDraftCache('topic-a', { ...empty, text: 'Current draft' })

    expect(readChatDraftCache('topic-a').text).toBe('Current draft')
    MockCacheUtils.resetMocks()
    expect(readChatDraftCache('topic-a')).toEqual(empty)
  })

  it('ignores a malformed recovery copy', () => {
    const empty = readChatDraftCache('topic-a')
    sessionStorage.setItem(getChatDraftCacheKey('topic-a'), '{')

    expect(readChatDraftCache('topic-a')).toEqual(empty)
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
