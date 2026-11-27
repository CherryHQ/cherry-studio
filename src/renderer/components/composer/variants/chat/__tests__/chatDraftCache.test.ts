import { beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@data/CacheService'

import {
  type ChatComposerDraftCache,
  getChatDraftCacheKey,
  readChatDraftCache,
  readChatDraftPresence,
  writeChatDraftCache
} from '../chatDraftCache'

const emptyDraft = (): ChatComposerDraftCache => ({
  text: '',
  tokens: [],
  files: [],
  knowledgeBaseIds: [],
  mentionedModelIds: [],
  modelMultiSelectMode: false
})

const sampleDraft = (): ChatComposerDraftCache => ({
  ...emptyDraft(),
  text: 'Persistence check: unsent draft 12345',
  knowledgeBaseIds: ['kb-1']
})

const seedPersistedDraft = (topicId: string, draft: ChatComposerDraftCache, ttlMs = 60_000) => {
  localStorage.setItem(getChatDraftCacheKey(topicId), JSON.stringify({ expiresAt: Date.now() + ttlMs, value: draft }))
}

describe('chatDraftCache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a written draft through the memory tier', () => {
    writeChatDraftCache('topic-write', sampleDraft())

    expect(readChatDraftCache('topic-write')).toEqual(sampleDraft())
    expect(readChatDraftPresence('topic-write')).toBe(true)
  })

  it('mirrors written drafts to localStorage with a future expiry', () => {
    writeChatDraftCache('topic-mirror', sampleDraft())

    const raw = localStorage.getItem(getChatDraftCacheKey('topic-mirror'))
    expect(raw).not.toBeNull()
    const entry = JSON.parse(raw as string)
    expect(entry.expiresAt).toBeGreaterThan(Date.now())
    expect(entry.value).toEqual(sampleDraft())
  })

  it('restores the persisted draft after a reload (memory tier miss)', () => {
    // No writeChatDraftCache call: the memory tier holds nothing for this topic,
    // matching a fresh renderer after a window reload.
    seedPersistedDraft('topic-reload', sampleDraft())

    expect(readChatDraftCache('topic-reload')).toEqual(sampleDraft())
    // The read rehydrates the memory tier for the rest of the session.
    expect(cacheService.get(getChatDraftCacheKey('topic-reload'))).toEqual(sampleDraft())
  })

  it('drops the persisted mirror when the draft is cleared', () => {
    writeChatDraftCache('topic-clear', sampleDraft())
    expect(localStorage.getItem(getChatDraftCacheKey('topic-clear'))).not.toBeNull()

    writeChatDraftCache('topic-clear', emptyDraft())

    expect(localStorage.getItem(getChatDraftCacheKey('topic-clear'))).toBeNull()
    expect(readChatDraftPresence('topic-clear')).toBe(false)
  })

  it('ignores and removes an expired persisted draft', () => {
    seedPersistedDraft('topic-expired', sampleDraft(), -1)

    expect(readChatDraftCache('topic-expired')).toEqual(emptyDraft())
    expect(localStorage.getItem(getChatDraftCacheKey('topic-expired'))).toBeNull()
  })

  it('ignores a malformed persisted entry', () => {
    localStorage.setItem(getChatDraftCacheKey('topic-broken'), '{not json')

    expect(readChatDraftCache('topic-broken')).toEqual(emptyDraft())
  })
})
