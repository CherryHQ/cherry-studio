import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('rehydrates with only the remaining persisted lifetime', () => {
    const set = vi.spyOn(cacheService, 'set')
    seedPersistedDraft('topic-remaining', sampleDraft(), 60_000)

    expect(readChatDraftCache('topic-remaining')).toEqual(sampleDraft())
    const call = set.mock.calls.find(([key]) => key === getChatDraftCacheKey('topic-remaining'))
    expect(call?.[2]).toBeGreaterThan(0)
    expect(call?.[2]).toBeLessThanOrEqual(60_000)
    set.mockRestore()
  })

  it('removes an old mirror if the replacement write fails', () => {
    writeChatDraftCache('topic-quota', sampleDraft())
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      writeChatDraftCache('topic-quota', { ...sampleDraft(), text: 'newer edit' })
      expect(localStorage.getItem(getChatDraftCacheKey('topic-quota'))).toBeNull()
      expect(readChatDraftCache('topic-quota').text).toBe('newer edit')
    } finally {
      set.mockRestore()
    }
  })

  it('preserves generated image bytes in attachments and token payloads after reload', async () => {
    const blob = new Blob(['image bytes'], { type: 'image/png' })
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => new TextEncoder().encode('image bytes').buffer })
    const file = {
      fileTokenSourceId: 'generated-1',
      blob,
      name: 'image.png',
      origin_name: 'image.png',
      ext: '.png',
      size: 11,
      type: 'image'
    } as const
    const draft = {
      ...sampleDraft(),
      files: [file],
      tokens: [
        {
          id: 'file:generated-1',
          kind: 'file',
          label: 'image.png',
          index: 0,
          textOffset: 0,
          payload: file
        }
      ]
    } as ChatComposerDraftCache
    writeChatDraftCache('topic-image', draft)
    await vi.waitFor(() => expect(localStorage.getItem(getChatDraftCacheKey('topic-image'))).not.toBeNull())
    const get = vi.spyOn(cacheService, 'get').mockReturnValue(undefined)
    try {
      const restored = readChatDraftCache('topic-image')
      expect(restored.files[0].blob).toBeInstanceOf(Blob)
      expect(restored.files[0].blob?.size).toBe(11)
      expect((restored.tokens[0].payload as typeof file).blob).toBeInstanceOf(Blob)
      expect(restored.files[0].blob?.type).toBe('image/png')
    } finally {
      get.mockRestore()
    }
  })

  it('does not resurrect an image draft cleared while serialization is pending', async () => {
    let complete!: (value: ArrayBuffer) => void
    const blob = new Blob(['image'])
    Object.defineProperty(blob, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          complete = resolve
        })
    })
    writeChatDraftCache('topic-image-clear', {
      ...sampleDraft(),
      files: [
        {
          fileTokenSourceId: 'image',
          blob,
          name: 'x.png',
          origin_name: 'x.png',
          ext: '.png',
          size: 5,
          type: 'image'
        }
      ]
    })
    writeChatDraftCache('topic-image-clear', emptyDraft())
    complete(new TextEncoder().encode('image').buffer)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(localStorage.getItem(getChatDraftCacheKey('topic-image-clear'))).toBeNull()
  })

  it('rejects malformed persisted attachment and token records', () => {
    seedPersistedDraft('topic-null-file', { ...sampleDraft(), files: [null] } as unknown as ChatComposerDraftCache)
    expect(readChatDraftCache('topic-null-file')).toEqual(emptyDraft())
    expect(localStorage.getItem(getChatDraftCacheKey('topic-null-file'))).toBeNull()
    seedPersistedDraft('topic-null-token', { ...sampleDraft(), tokens: [null] } as unknown as ChatComposerDraftCache)
    expect(readChatDraftCache('topic-null-token')).toEqual(emptyDraft())
  })

  it('ignores a malformed persisted entry', () => {
    localStorage.setItem(getChatDraftCacheKey('topic-broken'), '{not json')

    expect(readChatDraftCache('topic-broken')).toEqual(emptyDraft())
    expect(localStorage.getItem(getChatDraftCacheKey('topic-broken'))).toBeNull()
  })
})
