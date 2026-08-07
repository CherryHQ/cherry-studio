import { cacheService } from '@data/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedToken } from '../../tokens'
import {
  getCacheableDraft,
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

const KNOWLEDGE_PROMPT_TEXT =
  'The user attached knowledge base "Base 1" (id: base-1) — use that id with the kb_* tools.'

const knowledgeToken: ComposerSerializedToken = {
  id: 'knowledge:base-1',
  kind: 'knowledge',
  label: 'Base 1',
  promptText: KNOWLEDGE_PROMPT_TEXT,
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

const linkToken: ComposerSerializedToken = {
  id: 'link-token-1',
  kind: 'link',
  label: 'example.com/docs',
  promptText: 'https://example.com/docs',
  index: 3,
  textOffset: 0
}

/** `summarize <knowledge sentence> quoted text` — chips serialize with a trailing separator space. */
const PREFIX = 'summarize '
const draftWithKnowledge = {
  text: `${PREFIX}${KNOWLEDGE_PROMPT_TEXT} quoted text`,
  tokens: [
    { ...knowledgeToken, index: 0, textOffset: PREFIX.length },
    { ...quoteToken, index: 1, textOffset: PREFIX.length + KNOWLEDGE_PROMPT_TEXT.length + 1 }
  ]
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

  it('drops a knowledge token together with the sentence it contributed', () => {
    // Left behind, the sentence restores as chip-less prose telling the model a base is attached while
    // the send path — which derives the scope from the token — attaches none.
    expect(getCacheableDraft(draftWithKnowledge)).toEqual({
      text: `${PREFIX}quoted text`,
      tokens: [{ ...quoteToken, index: 0, textOffset: PREFIX.length }]
    })
  })

  it('collapses a pick-only draft back to empty rather than to the separator space', () => {
    expect(
      getCacheableDraft({ text: `${KNOWLEDGE_PROMPT_TEXT} `, tokens: [{ ...knowledgeToken, index: 0, textOffset: 0 }] })
    ).toEqual({ text: '', tokens: [] })
  })

  it('excises knowledge tokens on both read and write', () => {
    vi.mocked(cacheService.getCasual).mockReturnValue({ ...draftWithKnowledge, files: [] })
    expect(readChatDraftCache()).toEqual({
      text: `${PREFIX}quoted text`,
      tokens: [{ ...quoteToken, index: 0, textOffset: PREFIX.length }],
      files: []
    })

    writeChatDraftCache(draftWithKnowledge.text, draftWithKnowledge.tokens, [file])
    expect(cacheService.setCasual).toHaveBeenCalledWith(
      INPUTBAR_DRAFT_CACHE_KEY,
      {
        text: `${PREFIX}quoted text`,
        tokens: [{ ...quoteToken, index: 0, textOffset: PREFIX.length }],
        files: [file]
      },
      expect.any(Number)
    )
  })

  it('leaves a draft without knowledge tokens untouched', () => {
    const draft = { text: 'hello world', tokens: [fileToken] }
    expect(getCacheableDraft(draft)).toBe(draft)
  })

  it('round-trips a written draft', () => {
    writeChatDraftCache('hello world', [fileToken, quoteToken, linkToken], [file])

    const written = vi.mocked(cacheService.setCasual).mock.calls[0][1]
    vi.mocked(cacheService.getCasual).mockReturnValue(written)

    expect(readChatDraftCache()).toEqual({
      text: 'hello world',
      tokens: [fileToken, quoteToken, linkToken],
      files: [file]
    })
  })
})
