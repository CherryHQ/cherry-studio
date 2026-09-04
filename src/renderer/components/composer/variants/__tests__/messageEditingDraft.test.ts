import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { createComposerDraftContent, serializeComposerDocument } from '../../composerDraft'
import type { ComposerSerializedToken } from '../../tokens'
import { createEditableMessageDraft, replaceEditedMessageParts } from '../chat/messageEditingDraft'

const parts = (...items: Array<Record<string, unknown>>) => items as CherryMessagePart[]
const tool = (id: string) => ({ type: 'dynamic-tool', toolCallId: id, toolName: 'read', state: 'output-available' })
const text = (value: string) => ({ type: 'text', text: value })

const anchorsOf = (draftTokens: ComposerSerializedToken[]) =>
  draftTokens
    .filter((token) => token.kind === 'messagePart')
    .map((token) => ({ partIndex: (token.payload as { partIndex: number }).partIndex, textOffset: token.textOffset }))

/** Mirrors what the editor hands back: the draft text with its anchors at the given offsets. */
const editedDraft = (value: string, anchors: Array<{ partIndex: number; textOffset: number }>) => ({
  text: value,
  tokens: anchors.map((anchor, index) => ({
    id: `message-part:${anchor.partIndex}`,
    kind: 'messagePart' as const,
    label: 'anchor',
    index,
    textOffset: anchor.textOffset,
    payload: { partIndex: anchor.partIndex }
  }))
})

describe('createEditableMessageDraft', () => {
  it('anchors every non-text part between the text parts', () => {
    const draft = createEditableMessageDraft(parts(text('before tool'), tool('tool-1'), text('after tool')))

    // One newline each side puts the chip on its own line while spending exactly the `\n\n` that
    // already separates two text parts, so deleting it cannot leave a blank line behind.
    expect(draft.text).toBe('before tool\n\nafter tool')
    expect(anchorsOf(draft.draftTokens)).toEqual([{ partIndex: 1, textOffset: 'before tool\n'.length }])
  })

  it('round-trips its anchors through the editor document', () => {
    const draft = createEditableMessageDraft(parts(text('before tool'), tool('tool-1'), text('after tool')))
    const document = createComposerDraftContent({ text: draft.text, tokens: draft.draftTokens })
    const serialized = serializeComposerDocument(document)

    expect(serialized.text).toBe(draft.text)
    expect(anchorsOf(serialized.tokens)).toEqual(anchorsOf(draft.draftTokens))
  })

  it('leaves parts outside the text span unanchored so they keep their side', () => {
    const draft = createEditableMessageDraft(
      parts({ type: 'reasoning', text: 'reasoning' }, text('answer'), { type: 'source-url', url: 'https://a.example' })
    )

    expect(draft.text).toBe('answer')
    expect(anchorsOf(draft.draftTokens)).toEqual([])
  })
})

describe('replaceEditedMessageParts', () => {
  it('keeps an anchored tool where it was and rewrites only the text around it', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('edited before\n\nedited after', [
      { partIndex: 1, textOffset: 'edited before\n\n'.length }
    ])

    expect(replaceEditedMessageParts(originalParts, draft, parts(text('edited before\n\nedited after')))).toEqual([
      text('edited before'),
      originalParts[1],
      text('edited after')
    ])
  })

  it('moves an anchored tool when the edit moves its chip', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('all the text', [{ partIndex: 1, textOffset: 0 }])

    expect(replaceEditedMessageParts(originalParts, draft, parts(text('all the text')))).toEqual([
      originalParts[1],
      text('all the text')
    ])
  })

  it('drops a part whose anchor the edit deleted', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('just the text', [])

    expect(replaceEditedMessageParts(originalParts, draft, parts(text('just the text')))).toEqual([
      text('just the text')
    ])
  })

  it('leaves no blank-line residue behind a deleted anchor', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    // Deleting the chip removes no characters, so the draft text is what the editor still holds.
    const { text: draftText } = createEditableMessageDraft(originalParts)

    expect(replaceEditedMessageParts(originalParts, editedDraft(draftText, []), parts(text(draftText)))).toEqual([
      text('before tool\n\nafter tool')
    ])
  })

  it('keeps whitespace the user authored next to an anchor', () => {
    const originalParts = parts(text('intro'), tool('tool-1'), text('    indented'))
    const draft = editedDraft('intro  \n\n    indented', [{ partIndex: 1, textOffset: 'intro  \n'.length }])

    // A Markdown hard break's trailing spaces and an indented code block both die under `trim()`.
    expect(replaceEditedMessageParts(originalParts, draft, parts(text(draft.text)))).toEqual([
      text('intro  '),
      originalParts[1],
      text('    indented')
    ])
  })

  it('preserves unanchored parts on their own side of the text and drops derived translations', () => {
    const originalParts = parts(
      { type: 'reasoning', text: 'reasoning' },
      text('before tool'),
      tool('tool-1'),
      text('after tool'),
      { type: 'data-translation', data: { content: 'translated', targetLanguage: 'en-us' } },
      { type: 'source-url', url: 'https://a.example' }
    )
    const draft = editedDraft('one\n\ntwo', [{ partIndex: 2, textOffset: 'one\n\n'.length }])

    expect(replaceEditedMessageParts(originalParts, draft, parts(text('one\n\ntwo')))).toEqual([
      originalParts[0],
      text('one'),
      originalParts[2],
      text('two'),
      originalParts[5]
    ])
  })

  it('keeps the rebuilt attachments after the text when the message has no anchors', () => {
    const originalParts = parts(text('answer'), { type: 'file', mediaType: 'image/png', url: 'file:///old.png' })
    const editedParts = parts(text('edited answer'), { type: 'file', mediaType: 'image/png', url: 'file:///new.png' })

    expect(replaceEditedMessageParts(originalParts, editedDraft('edited answer', []), editedParts)).toEqual(editedParts)
  })
})
