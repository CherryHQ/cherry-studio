import { FILE_TYPE } from '@renderer/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { createComposerDraftContent, serializeComposerDocument } from '../../../composerDraft'
import type { ComposerSerializedToken } from '../../../tokens'
import { createEditableMessageDraft, replaceEditedMessageParts } from '../messageEditingDraft'

const imageParts = [
  {
    type: 'text',
    text: 'look at this',
    providerMetadata: {
      cherry: {
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file:shot-1',
              kind: 'file',
              label: 'shot.png',
              index: 0,
              textOffset: 0,
              payload: { name: 'shot.png', origin_name: 'shot.png', ext: '.png', size: 238_592, type: FILE_TYPE.IMAGE }
            }
          ]
        }
      }
    }
  },
  {
    type: 'file',
    url: 'file:///tmp/shot.png',
    mediaType: 'image/png',
    filename: 'shot.png',
    providerMetadata: { cherry: { fileTokenSourceId: 'shot-1' } }
  }
] as unknown as CherryMessagePart[]

const MESSAGE_ID = 'assistant-message-1'

const parts = (...items: Array<Record<string, unknown>>) => items as CherryMessagePart[]
const tool = (id: string) => ({ type: 'dynamic-tool', toolCallId: id, toolName: 'read', state: 'output-available' })
const text = (value: string) => ({ type: 'text', text: value })

const draftFor = (...items: Array<Record<string, unknown>>) => createEditableMessageDraft(parts(...items), MESSAGE_ID)

const anchorsOf = (draftTokens: ComposerSerializedToken[]) =>
  draftTokens
    .filter((token) => token.kind === 'messagePart')
    .map((token) => ({ id: token.id, textOffset: token.textOffset }))

/**
 * Mirrors what the editor hands back. Anchors carry an id and nothing else on purpose:
 * `ComposerTokenNode.renderHTML` drops `payload`, so anything that survives a DOM round trip —
 * a drag, an undo, the editor's own copy of the document — keeps only the id.
 */
const editedDraft = (value: string, anchors: Array<{ partIndex: number; textOffset: number; messageId?: string }>) => ({
  text: value,
  tokens: anchors.map((anchor, index) => ({
    id: `message-part:${anchor.messageId ?? MESSAGE_ID}:${anchor.partIndex}`,
    kind: 'messagePart' as const,
    label: 'anchor',
    index,
    textOffset: anchor.textOffset
  }))
})

describe('createEditableMessageDraft', () => {
  // The stored part has no filesystem path, so without the URL the edit composer has no image to preview.
  it('carries the stored file URL as the attachment preview source', () => {
    const draft = createEditableMessageDraft(imageParts, MESSAGE_ID)

    expect(draft.files).toHaveLength(1)
    expect(draft.files[0].path).toBeUndefined()
    expect(draft.files[0].previewUrl).toBe('file:///tmp/shot.png')
  })

  it('restores the attachment onto its file token so the token renders like a live one', () => {
    const draft = createEditableMessageDraft(imageParts, MESSAGE_ID)

    const fileToken = draft.draftTokens.find((token) => token.kind === 'file')
    expect(fileToken?.payload).toBe(draft.files[0])
  })

  it('recovers size and type from the stored token payload', () => {
    const draft = createEditableMessageDraft(imageParts, MESSAGE_ID)

    expect(draft.files[0].size).toBe(238_592)
    expect(draft.files[0].type).toBe(FILE_TYPE.IMAGE)
  })

  it('anchors every non-text part between the text parts', () => {
    const draft = draftFor(text('before tool'), tool('tool-1'), text('after tool'))

    // The chip spends the one newline that puts it on its own line, so the text either side reads
    // as the `\n\n` join it already was.
    expect(draft.text).toBe('before tool\n\nafter tool')
    expect(anchorsOf(draft.draftTokens)).toEqual([
      { id: `message-part:${MESSAGE_ID}:1`, textOffset: 'before tool\n'.length }
    ])
  })

  it('shares one line between adjacent anchors so deleting them leaves no blank line', () => {
    const draft = draftFor(text('before'), tool('tool-1'), tool('tool-2'), text('after'))

    expect(draft.text).toBe('before\n\nafter')
    expect(anchorsOf(draft.draftTokens)).toEqual([
      { id: `message-part:${MESSAGE_ID}:1`, textOffset: 'before\n'.length },
      { id: `message-part:${MESSAGE_ID}:2`, textOffset: 'before\n'.length }
    ])
  })

  it('round-trips its anchors through the editor document', () => {
    const draft = draftFor(text('before tool'), tool('tool-1'), tool('tool-2'), text('after tool'))
    const document = createComposerDraftContent({ text: draft.text, tokens: draft.draftTokens })
    const serialized = serializeComposerDocument(document)

    expect(serialized.text).toBe(draft.text)
    expect(anchorsOf(serialized.tokens)).toEqual(anchorsOf(draft.draftTokens))
  })

  it('leaves parts outside the text span unanchored so they keep their side', () => {
    const draft = draftFor({ type: 'reasoning', text: 'reasoning' }, text('answer'), {
      type: 'source-url',
      url: 'https://a.example'
    })

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

    expect(
      replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text('edited before\n\nedited after')))
    ).toEqual([text('edited before'), originalParts[1], text('edited after')])
  })

  it('resolves an anchor from its id alone, the only field a DOM round trip preserves', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('moved\n\ntext', [{ partIndex: 1, textOffset: 'moved\n'.length }])

    expect(draft.tokens[0]).not.toHaveProperty('payload')
    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text(draft.text)))).toEqual([
      text('moved'),
      originalParts[1],
      text('text')
    ])
  })

  it('ignores an anchor addressed to another message instead of splicing that index', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('one\n\ntwo', [
      { partIndex: 1, textOffset: 'one\n'.length, messageId: 'assistant-message-2' }
    ])

    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text(draft.text)))).toEqual([
      text('one\n\ntwo')
    ])
  })

  it('moves an anchored tool when the edit moves its chip', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('all the text', [{ partIndex: 1, textOffset: 0 }])

    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text('all the text')))).toEqual([
      originalParts[1],
      text('all the text')
    ])
  })

  it('drops a part whose anchor the edit deleted', () => {
    const originalParts = parts(text('before tool'), tool('tool-1'), text('after tool'))
    const draft = editedDraft('just the text', [])

    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text('just the text')))).toEqual([
      text('just the text')
    ])
  })

  it.each([
    { name: 'one anchor', items: [text('before'), tool('tool-1'), text('after')] },
    { name: 'adjacent anchors', items: [text('before'), tool('tool-1'), tool('tool-2'), text('after')] }
  ])('leaves no blank-line residue behind deleted anchors — $name', ({ items }) => {
    const originalParts = parts(...items)
    // Deleting a chip removes no characters, so the draft text is what the editor still holds.
    const { text: draftText } = createEditableMessageDraft(originalParts, MESSAGE_ID)

    expect(
      replaceEditedMessageParts(originalParts, MESSAGE_ID, editedDraft(draftText, []), parts(text(draftText)))
    ).toEqual([text('before\n\nafter')])
  })

  it('keeps whitespace the user authored next to an anchor', () => {
    const originalParts = parts(text('intro'), tool('tool-1'), text('    indented'))
    const draft = editedDraft('intro  \n\n    indented', [{ partIndex: 1, textOffset: 'intro  \n'.length }])

    // A Markdown hard break's trailing spaces and an indented code block both die under `trim()`.
    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text(draft.text)))).toEqual([
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

    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, draft, parts(text('one\n\ntwo')))).toEqual([
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

    expect(replaceEditedMessageParts(originalParts, MESSAGE_ID, editedDraft('edited answer', []), editedParts)).toEqual(
      editedParts
    )
  })
})
