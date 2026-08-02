// oxlint-disable typescript/no-unnecessary-type-assertion -- tsgolint 7 false-positives vs tsc 7 (see #17746)
import { describe, expect, it, vi } from 'vitest'

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { CherryMessagePart } from '@shared/data/types/message'

import type * as ComposerDraftModule from '../../../composerDraft'
import type { ComposerSerializedDraft } from '../../../tokens'
import { buildComposerQueuedPayload, getComposerHistoryText } from '../composerQueuedPayload'

// `createComposerUserMessageParts` is mocked below for the payload tests, but the history tests need
// the real composer snapshot (token offsets + prompt text) that the excision walks.
const { createComposerUserMessageParts } = await vi.importActual<typeof ComposerDraftModule>('../../../composerDraft')

vi.mock('../../../composerDraft', async (importOriginal) => ({
  ...(await importOriginal<typeof ComposerDraftModule>()),
  createComposerUserMessageParts: vi.fn((draft: ComposerSerializedDraft) => [{ type: 'text', text: draft.text }])
}))

const file = (id: string): ComposerAttachment => ({ fileTokenSourceId: id, path: `/tmp/${id}` }) as ComposerAttachment
const fileTokenId = (f: ComposerAttachment) => `file:${f.fileTokenSourceId}`

const draft = (text: string, tokenIds: string[] = [], tokenTextOffset = 0): ComposerSerializedDraft => ({
  text,
  tokens: tokenIds.map((id, index) => ({
    id,
    kind: id.startsWith('file:') ? 'file' : 'knowledge',
    label: id,
    index,
    textOffset: tokenTextOffset
  }))
})

describe('buildComposerQueuedPayload', () => {
  it('returns null for empty text when text is required (chat)', () => {
    expect(buildComposerQueuedPayload(draft('   '), { files: [], fileTokenId, requireText: true })).toBeNull()
  })

  it('returns null when text is empty and there are no files (agent)', () => {
    expect(buildComposerQueuedPayload(draft(''), { files: [], fileTokenId })).toBeNull()
  })

  it('does not treat whitespace on a token-only line as text', () => {
    expect(buildComposerQueuedPayload(draft('   ', ['knowledge:k1']), { files: [], fileTokenId })).toBeNull()
  })

  it('allows a file-only draft when text is not required (agent)', () => {
    const result = buildComposerQueuedPayload(draft('', ['file:a']), { files: [file('a')], fileTokenId })

    expect(result).not.toBeNull()
    expect(result?.attachments).toHaveLength(1)
    expect(result?.userMessageParts).toEqual([{ type: 'text', text: '' }])
  })

  it('normalizes whitespace-only attachment payload text to empty', () => {
    const result = buildComposerQueuedPayload(draft('   ', ['file:a']), { files: [file('a')], fileTokenId })

    expect(result?.text).toBe('')
  })

  it('returns null for a file-only draft whose file token has not reached the editor draft yet', () => {
    const result = buildComposerQueuedPayload(draft('', []), { files: [file('a')], fileTokenId })

    expect(result).toBeNull()
  })

  it('returns null for a text draft whose file token has not reached the editor draft yet', () => {
    const result = buildComposerQueuedPayload(draft('summarize this', []), { files: [file('a')], fileTokenId })

    expect(result).toBeNull()
  })

  it('returns null when only some current file tokens have reached the editor draft', () => {
    const synced = file('a')
    const unsynced = file('b')

    const result = buildComposerQueuedPayload(draft('hi', ['file:a']), {
      files: [synced, unsynced],
      fileTokenId,
      requireText: true
    })

    expect(result).toBeNull()
  })

  it('attaches files when every current file is present as a draft token', () => {
    const first = file('a')
    const second = file('b')

    const result = buildComposerQueuedPayload(draft('hi', ['file:a', 'file:b']), {
      files: [first, second],
      fileTokenId,
      requireText: true
    })

    expect(result?.attachments).toEqual([first, second])
    expect(result?.userMessageParts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('trims only boundary blank lines and merges variant-specific extra fields', () => {
    const result = buildComposerQueuedPayload(draft('\n  hello  \n\n', ['knowledge:k1'], 1), {
      files: [],
      fileTokenId,
      requireText: true,
      extra: (tokenIds) => ({ reasoningEffort: tokenIds.has('knowledge:k1') ? 'high' : undefined })
    })

    expect(result?.text).toBe('  hello  ')
    expect(result?.userMessageParts).toEqual([{ type: 'text', text: '  hello  ' }])
    expect(result?.reasoningEffort).toBe('high')
  })
})

describe('getComposerHistoryText', () => {
  const KNOWLEDGE_PROMPT = 'The user attached knowledge base "Notes" (id: kb-1).'
  const SKILL_PROMPT = 'Use the pdf skill.'

  const promptDraft = (before: string, prompts: Array<{ kind: 'knowledge' | 'skill'; text: string }>) => {
    let textOffset = before.length
    const tokens = prompts.map((prompt, index) => {
      const token = {
        id: `${prompt.kind}:${index}`,
        kind: prompt.kind,
        label: prompt.kind,
        index,
        textOffset,
        promptText: prompt.text
      }
      textOffset += prompt.text.length + 1
      return token
    })
    return { text: `${before}${prompts.map((prompt) => `${prompt.text} `).join('')}tail`, tokens }
  }

  it('drops a knowledge prompt span so the replayed entry cannot claim an unauthorized base', () => {
    const draft = promptDraft('summarize ', [{ kind: 'knowledge', text: KNOWLEDGE_PROMPT }])

    const history = getComposerHistoryText(createComposerUserMessageParts(draft as ComposerSerializedDraft))

    expect(history).not.toContain('kb-1')
    expect(history).not.toContain(KNOWLEDGE_PROMPT)
    expect(history).toContain('summarize')
    expect(history).toContain('tail')
  })

  it('keeps every other kind verbatim — only knowledge needs an accompanying scope part', () => {
    const draft = promptDraft('summarize ', [
      { kind: 'knowledge', text: KNOWLEDGE_PROMPT },
      { kind: 'skill', text: SKILL_PROMPT }
    ])

    const history = getComposerHistoryText(createComposerUserMessageParts(draft as ComposerSerializedDraft))

    expect(history).toContain(SKILL_PROMPT)
    expect(history).not.toContain(KNOWLEDGE_PROMPT)
  })

  it('leaves a knowledge-free draft byte-identical rather than rewriting tokens to clipboard markers', () => {
    const draft = promptDraft('summarize ', [{ kind: 'skill', text: SKILL_PROMPT }])

    const history = getComposerHistoryText(createComposerUserMessageParts(draft as ComposerSerializedDraft))

    expect(history).toBe(draft.text)
  })

  it('passes a part without composer metadata through untouched', () => {
    expect(getComposerHistoryText([{ type: 'text', text: 'plain text' } as CherryMessagePart])).toBe('plain text')
  })
})
