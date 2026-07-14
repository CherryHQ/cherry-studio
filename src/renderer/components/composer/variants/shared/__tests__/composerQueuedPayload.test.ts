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
