import { describe, expect, it } from 'vitest'

import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import type { FileUIPart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

import { createComposerUserMessageParts } from '../composerDraft'
import { createOrderedComposerParts } from '../composerOrderedParts'
import type { ComposerSerializedDraft } from '../tokens'
import { createEditableMessageDraft } from '../variants/chat/messageEditingDraft'

const file = (id: string): FileUIPart => ({
  type: 'file',
  url: `file:///tmp/${id}.png`,
  filename: 'same.png',
  mediaType: 'image/png',
  providerMetadata: { cherry: { fileTokenSourceId: id } }
})
const token = (id: string, textOffset: number, index: number) => ({
  id: `file:${id}`,
  kind: 'file' as const,
  label: 'same.png',
  textOffset,
  index
})

// Catches attachment array order replacing the user's text/file association, including after editing.
it('preserves UTF-16 text and distinct same-name attachments across send, reload, and edit', () => {
  const draft: ComposerSerializedDraft = {
    text: '中文😀  \n    middle\nend  ',
    tokens: [token('a', 4, 0), token('b', 18, 1)]
  }
  const parts = createOrderedComposerParts(createComposerUserMessageParts(draft), [file('b'), file('a')])
  expect(parts.map((p) => (p.type === 'text' ? p.text : p.type === 'file' ? p.url : ''))).toEqual([
    '中文😀',
    'file:///tmp/a.png',
    '  \n    middle\n',
    'file:///tmp/b.png',
    'end  '
  ])
  const restored = createEditableMessageDraft(JSON.parse(JSON.stringify(parts)), 'm1')
  expect(restored.text).toBe(draft.text)
  expect(restored.draftTokens.map((t) => [t.id, t.textOffset])).toEqual([
    ['file:a', 4],
    ['file:b', 18]
  ])
  expect(getComposerTextFromParts(parts)).toBe('中文😀same.png  \n    middle\nsame.pngend  ')
  expect(getComposerTextFromParts(parts, (token) => (token.id === 'file:a' ? 'pasted content' : token.label))).toBe(
    '中文😀pasted content  \n    middle\nsame.pngend  '
  )
  expect(
    createOrderedComposerParts(createComposerUserMessageParts({ text: restored.text, tokens: restored.draftTokens }), [
      file('b'),
      file('a')
    ])
  ).toEqual(parts)
})

it('keeps equal-offset files and non-file tokens in editor order, including file-only messages', () => {
  const parts = createOrderedComposerParts(
    createComposerUserMessageParts({
      text: '',
      tokens: [
        token('b', 0, 0),
        { id: 'skill:x', kind: 'skill', label: 'x', textOffset: 0, index: 1 },
        token('a', 0, 2)
      ]
    }),
    [file('a'), file('b')]
  )
  expect(parts.map((p) => p.type)).toEqual(['file', 'text', 'file'])
  expect(createEditableMessageDraft(parts, 'm').draftTokens.map((t) => t.id)).toEqual(['file:b', 'skill:x', 'file:a'])
  expect(
    parts
      .filter((p) => p.type === 'text')
      .flatMap((p) => readCherryMeta(p)?.composer?.tokens ?? [])
      .some((t) => t.kind === 'file')
  ).toBe(false)
})

describe('attachment identity validation', () => {
  it('rejects missing, duplicate, and unanchored attachments without guessing by filename', () => {
    const parts = createComposerUserMessageParts({ text: 'AB', tokens: [token('a', 1, 0)] })
    expect(() => createOrderedComposerParts(parts, [])).toThrow('Missing composer attachment')
    expect(() => createOrderedComposerParts(parts, [file('a'), file('a')])).toThrow('Ambiguous')
    expect(() => createOrderedComposerParts(parts, [file('a'), file('b')])).toThrow('no position')
    expect(() => createOrderedComposerParts(parts, [file('b')])).toThrow('Missing composer attachment')
  })
  it('rebuilds a moved file and does not restore a deleted file', () => {
    const parts = createOrderedComposerParts(
      createComposerUserMessageParts({ text: 'AB', tokens: [token('a', 1, 0), token('b', 2, 1)] }),
      [file('a'), file('b')]
    )
    const draft = createEditableMessageDraft(parts, 'm')
    const edited = createOrderedComposerParts(
      createComposerUserMessageParts({ text: draft.text, tokens: [{ ...draft.draftTokens[1], textOffset: 0 }] }),
      [file('b')]
    )
    expect(edited.map((p) => (p.type === 'text' ? p.text : p.type === 'file' ? p.url : ''))).toEqual([
      'file:///tmp/b.png',
      'AB'
    ])
  })
})
