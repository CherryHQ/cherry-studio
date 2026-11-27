import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import {
  type ChatComposerDraftCache,
  createChatDraftOwner,
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
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_key: string, action: () => void) => {
          action()
          return Promise.resolve()
        }
      }
    })

    localStorage.clear()
    sessionStorage.clear()
  })

  it('prevents an untouched window cleanup from deleting a newer draft', () => {
    const untouched = createChatDraftOwner('topic-owner')
    const editing = createChatDraftOwner('topic-owner')
    writeChatDraftCache('topic-owner', sampleDraft(), { owner: editing })
    writeChatDraftCache('topic-owner', emptyDraft(), { owner: untouched, onlyIfOwned: true })
    expect(JSON.parse(localStorage.getItem(getChatDraftCacheKey('topic-owner'))!).value.text).toBe(sampleDraft().text)
  })

  it('prevents stale cleanup from restoring a draft after another window clears it', () => {
    const stale = createChatDraftOwner('topic-owner-clear')
    writeChatDraftCache('topic-owner-clear', sampleDraft(), { owner: stale })
    const sender = createChatDraftOwner('topic-owner-clear')
    writeChatDraftCache('topic-owner-clear', emptyDraft(), { owner: sender })
    writeChatDraftCache('topic-owner-clear', sampleDraft(), { owner: stale, onlyIfOwned: true })
    expect(localStorage.getItem(getChatDraftCacheKey('topic-owner-clear'))).toBeNull()
  })

  it.each([false, true])('binds remounted cleanup to its cached snapshot revision (nonempty: %s)', (nonempty) => {
    const topic = `topic-remount-${nonempty}`
    const stale = nonempty ? sampleDraft() : emptyDraft()
    writeChatDraftCache(topic, stale)
    const oldMemory = cacheService.get(getChatDraftCacheKey(topic))
    if (!oldMemory) throw new Error('Expected the written draft in memory')
    writeChatDraftCache(topic, nonempty ? emptyDraft() : sampleDraft())
    const newerMirror = localStorage.getItem(getChatDraftCacheKey(topic))
    // Simulate another renderer updating storage without replacing this renderer's memory tier.
    cacheService.set(getChatDraftCacheKey(topic), oldMemory)
    const loaded = readChatDraftCache(topic)
    const remounted = createChatDraftOwner(topic, loaded)
    writeChatDraftCache(topic, loaded, { owner: remounted, onlyIfOwned: true })
    expect(localStorage.getItem(getChatDraftCacheKey(topic))).toBe(newerMirror)
  })

  it('restores text after reload while its shared lock callback is still queued', () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: () => new Promise(() => {}) }
    })
    writeChatDraftCache('topic-pending-reload', sampleDraft())
    vi.mocked(cacheService.get).mockReturnValueOnce(undefined)
    expect(readChatDraftCache('topic-pending-reload')).toEqual(sampleDraft())
    vi.mocked(cacheService.get).mockReturnValueOnce(undefined)
    expect(readChatDraftCache('topic-pending-reload')).toEqual(sampleDraft())
  })

  it('does not restore pending text after another window advances the revision', () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: () => new Promise(() => {}) }
    })
    writeChatDraftCache('topic-pending-sent', sampleDraft())
    localStorage.setItem(`${getChatDraftCacheKey('topic-pending-sent')}.revision`, 'sent-in-other-window')
    vi.mocked(cacheService.get).mockReturnValueOnce(undefined)
    expect(readChatDraftCache('topic-pending-sent')).toEqual(emptyDraft())
  })

  it.each([false, true])(
    'recovers the second queued edit after an own commit unless a foreign write intervenes: %s',
    (foreign) => {
      const callbacks: (() => void)[] = []
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: (_key: string, action: () => void) => {
            callbacks.push(action)
            return Promise.resolve()
          }
        }
      })
      const topic = `topic-two-edits-${foreign}`
      writeChatDraftCache(topic, { ...sampleDraft(), text: 'first' })
      writeChatDraftCache(topic, { ...sampleDraft(), text: 'second' })
      callbacks.shift()!()
      if (foreign) localStorage.setItem(`${getChatDraftCacheKey(topic)}.revision`, 'foreign')
      expect(readChatDraftCache(topic).text).toBe(foreign ? 'first' : 'second')
    }
  )

  it('preserves the absolute pending deadline through replay and memory hydration', () => {
    const callbacks: (() => void)[] = []
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_key: string, action: () => void) => {
          callbacks.push(action)
          return Promise.resolve()
        }
      }
    })
    const topic = 'topic-replay-expiry'
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      writeChatDraftCache(topic, sampleDraft())
      const deadline = JSON.parse(sessionStorage.getItem(`${getChatDraftCacheKey(topic)}.pending`)!).expiresAt
      callbacks.length = 0 // A reload discards the old renderer's queued callbacks.
      now.mockReturnValue(deadline - 100)
      expect(readChatDraftCache(topic)).toEqual(sampleDraft())
      callbacks.shift()!()
      expect(JSON.parse(localStorage.getItem(getChatDraftCacheKey(topic))!).expiresAt).toBe(deadline)
      expect(vi.mocked(cacheService.set).mock.calls.at(-1)?.[2]).toBe(100)
      now.mockReturnValue(deadline + 1)
      expect(readChatDraftCache(topic)).toEqual(emptyDraft())
    } finally {
      now.mockRestore()
    }
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

  it('rejects a draft whose deadline passes between validation and memory hydration', () => {
    seedPersistedDraft('topic-expiry-race', sampleDraft(), 100)
    const deadline = Date.now() + 100
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(deadline - 1)
      .mockReturnValue(deadline)
    const set = vi.spyOn(cacheService, 'set')
    try {
      expect(readChatDraftCache('topic-expiry-race')).toEqual(emptyDraft())
      expect(set.mock.calls.some(([key]) => key === getChatDraftCacheKey('topic-expiry-race'))).toBe(false)
      expect(localStorage.getItem(getChatDraftCacheKey('topic-expiry-race'))).toBeNull()
    } finally {
      now.mockRestore()
      set.mockRestore()
    }
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
    const raw = localStorage.getItem(getChatDraftCacheKey('topic-image'))!
    expect(raw.split(btoa('image bytes')).length - 1).toBe(1)
    const get = vi.spyOn(cacheService, 'get').mockReturnValue(undefined)
    try {
      const restored = readChatDraftCache('topic-image')
      expect(restored.files[0].blob).toBeInstanceOf(Blob)
      expect(restored.files[0].blob?.size).toBe(11)
      expect((restored.tokens[0].payload as typeof file).blob).toBeInstanceOf(Blob)
      expect(restored.files[0].blob?.type).toBe('image/png')
      expect((restored.tokens[0].payload as typeof file).blob).toBe(restored.files[0].blob)
    } finally {
      get.mockRestore()
    }
  })

  it('restores the previous inline Blob format and rejects unknown Blob references', () => {
    const file = {
      fileTokenSourceId: 'legacy-image',
      name: 'image.png',
      origin_name: 'image.png',
      ext: '.png',
      size: 5,
      type: 'image',
      blob: { __chatDraftBlob: true, type: 'image/png', data: btoa('image') }
    }
    seedPersistedDraft('topic-legacy-image', { ...sampleDraft(), files: [file] } as unknown as ChatComposerDraftCache)
    expect(readChatDraftCache('topic-legacy-image').files[0].blob).toBeInstanceOf(Blob)
    seedPersistedDraft('topic-broken-ref', {
      ...sampleDraft(),
      files: [{ ...file, blob: { __chatDraftBlobRef: 9 } }]
    } as unknown as ChatComposerDraftCache)
    expect(readChatDraftCache('topic-broken-ref')).toEqual(emptyDraft())
    expect(localStorage.getItem(getChatDraftCacheKey('topic-broken-ref'))).toBeNull()
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
