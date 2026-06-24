import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedDraft } from '../../../tokens'
import { buildComposerQueuedPayload } from '../composerQueuedPayload'

vi.mock('../../../composerDraft', () => ({
  createComposerUserMessageParts: vi.fn((draft: ComposerSerializedDraft) => [{ type: 'text', text: draft.text }])
}))

const file = (id: string): ComposerAttachment => ({ fileTokenSourceId: id, path: `/tmp/${id}` }) as ComposerAttachment
const fileTokenId = (f: ComposerAttachment) => `file:${f.fileTokenSourceId}`

const draft = (text: string, tokenIds: string[] = []): ComposerSerializedDraft => ({
  text,
  tokens: tokenIds.map((id, index) => ({
    id,
    kind: id.startsWith('file:') ? 'file' : 'knowledge',
    label: id,
    index,
    textOffset: 0
  }))
})

describe('buildComposerQueuedPayload', () => {
  it('returns null for empty text when text is required (chat)', () => {
    expect(buildComposerQueuedPayload(draft('   '), { files: [], fileTokenId, requireText: true })).toBeNull()
  })

  it('returns null when text is empty and there are no files (agent)', () => {
    expect(buildComposerQueuedPayload(draft(''), { files: [], fileTokenId })).toBeNull()
  })

  it('allows a file-only draft when text is not required (agent)', () => {
    const result = buildComposerQueuedPayload(draft('', ['file:a']), { files: [file('a')], fileTokenId })

    expect(result).not.toBeNull()
    expect(result?.attachments).toHaveLength(1)
    expect(result?.userMessageParts).toEqual([{ type: 'text', text: '' }])
  })

  it('attaches only files still present as draft tokens', () => {
    const kept = file('a')
    const removed = file('b')

    const result = buildComposerQueuedPayload(draft('hi', ['file:a']), {
      files: [kept, removed],
      fileTokenId,
      requireText: true
    })

    expect(result?.attachments).toEqual([kept])
    expect(result?.userMessageParts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('trims text and merges variant-specific extra fields', () => {
    const result = buildComposerQueuedPayload(draft('  hello  ', ['knowledge:k1']), {
      files: [],
      fileTokenId,
      requireText: true,
      extra: (tokenIds) => ({ knowledgeBaseIds: tokenIds.has('knowledge:k1') ? ['k1'] : undefined })
    })

    expect(result?.text).toBe('hello')
    expect(result?.knowledgeBaseIds).toEqual(['k1'])
  })
})
