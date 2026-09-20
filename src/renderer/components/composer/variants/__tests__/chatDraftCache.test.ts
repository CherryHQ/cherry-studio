import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

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
    get: vi.fn(),
    set: vi.fn(),
    getPersist: vi.fn(),
    setPersist: vi.fn()
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

const emptyDraft: ChatComposerDraftCache = {
  text: '',
  tokens: [],
  files: [],
  knowledgeBaseIds: [],
  mentionedModelIds: [],
  modelMultiSelectMode: false
}

type DraftSnapshot = Record<string, { draft: ChatComposerDraftCache; savedAt: number }>
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

describe('chatDraftCache', () => {
  beforeEach(() => {
    vi.mocked(cacheService.get).mockReset()
    vi.mocked(cacheService.set).mockReset()
    vi.mocked(cacheService.getPersist).mockReset().mockReturnValue({})
    vi.mocked(cacheService.setPersist).mockReset()
  })

  it('uses a separate cache key for each topic', () => {
    expect(getChatDraftCacheKey('topic-a')).toBe('chat.composer_draft.topic-a')
    expect(getChatDraftCacheKey('topic-b')).toBe('chat.composer_draft.topic-b')
  })

  it('reads an empty draft from a missing topic cache entry', () => {
    vi.mocked(cacheService.get).mockReturnValue(undefined)
    expect(readChatDraftCache('topic-a')).toEqual(emptyDraft)
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
    expect(hasChatDraftContent(emptyDraft)).toBe(false)
    expect(hasChatDraftContent({ ...emptyDraft, text: 'draft' })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, tokens: [quoteToken] })).toBe(true)
    expect(hasChatDraftContent({ ...emptyDraft, modelMultiSelectMode: true })).toBe(false)
  })

  // Restart-recovery: the renderer memory tier (chat.composer_draft.*) is wiped on every app
  // restart, so a genuinely unsent draft would otherwise vanish — see GOREVLER-2 R12.
  it('restores a draft from the persisted snapshot when the renderer memory cache is empty (e.g. after a restart)', () => {
    vi.mocked(cacheService.get).mockReturnValue(undefined)
    vi.mocked(cacheService.getPersist).mockReturnValue({
      'topic-a': { draft: { ...emptyDraft, text: 'recovered after restart' }, savedAt: Date.now() }
    } satisfies DraftSnapshot)

    expect(readChatDraftCache('topic-a').text).toBe('recovered after restart')
    expect(cacheService.getPersist).toHaveBeenCalledWith('chat.composer_draft_snapshot')
  })

  // The memory tier expires a draft after 24h. The persisted mirror has no expiry of its
  // own, so without this check a draft the app had already dropped would come back on the
  // next restart and keep coming back forever.
  it('does not resurrect a snapshot older than the memory tier TTL', () => {
    vi.mocked(cacheService.get).mockReturnValue(undefined)
    vi.mocked(cacheService.getPersist).mockReturnValue({
      'topic-a': { draft: { ...emptyDraft, text: 'expired' }, savedAt: Date.now() - DRAFT_TTL_MS - 1 }
    } satisfies DraftSnapshot)

    expect(readChatDraftCache('topic-a').text).toBe('')
  })

  it('prefers the live renderer memory cache over the persisted snapshot once the topic has a value this session', () => {
    vi.mocked(cacheService.get).mockReturnValue({ ...emptyDraft, text: 'live draft' })
    vi.mocked(cacheService.getPersist).mockReturnValue({
      'topic-a': { draft: { ...emptyDraft, text: 'stale snapshot' }, savedAt: Date.now() }
    } satisfies DraftSnapshot)

    expect(readChatDraftCache('topic-a').text).toBe('live draft')
  })

  it('mirrors a non-empty draft into the persisted snapshot, keyed by topic id', () => {
    const draft: ChatComposerDraftCache = { ...emptyDraft, text: 'hello world' }

    writeChatDraftCache('topic-a', draft)

    const [key, updater] = vi.mocked(cacheService.setPersist).mock.calls[0]
    expect(key).toBe('chat.composer_draft_snapshot')
    const otherTopic = { draft: { ...emptyDraft, text: 'other topic' }, savedAt: Date.now() }
    const next = (updater as (prev: DraftSnapshot) => DraftSnapshot)({ 'topic-b': otherTopic })
    expect(next['topic-b']).toEqual(otherTopic)
    expect(next['topic-a'].draft).toEqual(draft)
  })

  // Nothing else prunes this record: deleting a topic does not clear its draft, so without
  // the sweep every abandoned draft would stay in storage for good.
  it('sweeps snapshots past the TTL on write, including drafts whose topic is long gone', () => {
    writeChatDraftCache('topic-a', { ...emptyDraft, text: 'fresh' })

    const [, updater] = vi.mocked(cacheService.setPersist).mock.calls[0]
    const next = (updater as (prev: DraftSnapshot) => DraftSnapshot)({
      'deleted-topic': { draft: { ...emptyDraft, text: 'abandoned' }, savedAt: Date.now() - DRAFT_TTL_MS - 1 },
      'topic-b': { draft: { ...emptyDraft, text: 'still recent' }, savedAt: Date.now() }
    })

    expect(Object.keys(next).sort()).toEqual(['topic-a', 'topic-b'])
  })

  it('removes the topic from the persisted snapshot once its draft empties', () => {
    writeChatDraftCache('topic-a', emptyDraft)

    const [, updater] = vi.mocked(cacheService.setPersist).mock.calls[0]
    const keepMe = { draft: { ...emptyDraft, text: 'keep me' }, savedAt: Date.now() }
    const prev: DraftSnapshot = {
      'topic-a': { draft: { ...emptyDraft, text: 'leftover' }, savedAt: Date.now() },
      'topic-b': keepMe
    }
    const next = (updater as (prev: DraftSnapshot) => DraftSnapshot)(prev)
    expect(next).toEqual({ 'topic-b': keepMe })
  })
})
