import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getCacheableDraftTokens,
  INPUTBAR_DRAFT_CACHE_KEY,
  readChatDraftCache,
  writeChatDraftCache
} from '../chat/chatDraftCache'

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

  it('migrates a legacy plain-string cache value to a text-only draft', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue('legacy draft')

    expect(readChatDraftCache()).toEqual({ text: 'legacy draft', tokens: [], files: [] })
  })

  it('returns an empty draft for missing or malformed cache values', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue(undefined)
    expect(readChatDraftCache()).toEqual({ text: '', tokens: [], files: [] })

    vi.mocked(cacheService.getCasual).mockReturnValue({ text: 42, tokens: [] })
    expect(readChatDraftCache()).toEqual({ text: '', tokens: [], files: [] })

    vi.mocked(cacheService.getCasual).mockReturnValue({ text: 'hello', tokens: 'nope' })
    expect(readChatDraftCache()).toEqual({ text: '', tokens: [], files: [] })
  })

  it('filters knowledge tokens on read and write', () => {
    expect(getCacheableDraftTokens([fileToken, knowledgeToken, quoteToken])).toEqual([fileToken, quoteToken])

    vi.mocked(cacheService.getCasual).mockReturnValue({
      text: 'hello',
      tokens: [fileToken, knowledgeToken],
      files: []
    })
    expect(readChatDraftCache().tokens).toEqual([fileToken])

    writeChatDraftCache('hello', [fileToken, knowledgeToken, quoteToken], [file])
    expect(cacheService.setCasual).toHaveBeenCalledWith(
      INPUTBAR_DRAFT_CACHE_KEY,
      { text: 'hello', tokens: [fileToken, quoteToken], files: [file] },
      expect.any(Number)
    )
  })

  it('round-trips a written draft', () => {
    writeChatDraftCache('hello world', [fileToken, quoteToken], [file])

    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    vi.mocked(cacheService.getCasual).mockReturnValue(written)

    expect(readChatDraftCache()).toEqual({ text: 'hello world', tokens: [fileToken, quoteToken], files: [file] })
  })
})
