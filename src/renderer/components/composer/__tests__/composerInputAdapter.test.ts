import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { COMPOSER_INPUT_MAX_LENGTH, createComposerDraftContent, serializeComposerDocument } from '../composerDraft'
import { appendComposerText, createComposerInputAdapter, updateComposerToken } from '../composerInputAdapter'
import { createComposerEditorPreset } from '../composerPreset'
import { tokenizePromptVariablesInEditor } from '../promptVariables'
import { createEditableMessageDraft, replaceEditedMessageParts } from '../variants/chat/messageEditingDraft'

describe('createComposerInputAdapter', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function createEditor() {
    editor = new Editor({
      extensions: createComposerEditorPreset({}),
      content: '',
      onUpdate: ({ editor, transaction }) => {
        tokenizePromptVariablesInEditor(editor, transaction)
      }
    })
    return editor
  }

  it('preserves unselected file chips when replacing text immediately after them', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    adapter.insertToken!({ id: 'file-1', kind: 'file', label: 'attached.txt' }, { insertSeparator: false })
    adapter.insertText('replace me', { tokenizeVariables: false })
    editor.commands.setTextSelection({ from: 2, to: 12 })

    expect(adapter.replaceRange!(adapter.captureReplaceRange!()!, 'dictated text')).toBe(true)
    const draft = serializeComposerDocument(editor)
    expect(draft.text).toBe('dictated text')
    expect(draft.tokens).toMatchObject([{ id: 'file-1', kind: 'file', textOffset: 0 }])
  })

  it('appends literal text while preserving interleaved message parts on save', () => {
    const currentEditor = createEditor()
    const original: CherryMessagePart[] = [
      { type: 'text', text: 'Before' },
      { type: 'reasoning', text: 'Keep reasoning' },
      { type: 'text', text: 'After' }
    ]
    const editable = createEditableMessageDraft(original, 'message-1')
    currentEditor.commands.setContent(createComposerDraftContent({ text: editable.text, tokens: editable.draftTokens }))
    const before = serializeComposerDocument(currentEditor)
    currentEditor.commands.setTextSelection(1)
    expect(appendComposerText(currentEditor, 'Explain ${this}')).toBe(true)
    const draft = serializeComposerDocument(currentEditor)
    expect(draft.tokens).toEqual(before.tokens)
    expect(draft.text).toBe(before.text + '\nExplain ${this}')
    expect(replaceEditedMessageParts(original, 'message-1', draft, [{ type: 'text', text: draft.text }])).toEqual([
      original[0],
      original[1],
      { type: 'text', text: 'After\nExplain ${this}' }
    ])
  })

  it('appends text beyond the former input limit without truncating the draft', () => {
    const currentEditor = createEditor()
    const existingText = 'a'.repeat(40000)
    currentEditor.commands.setContent(existingText)
    expect(appendComposerText(currentEditor, 'Explain this')).toBe(true)
    expect(serializeComposerDocument(currentEditor).text).toBe(`${existingText}\nExplain this`)
  })

  it('updates an existing annotation in place without duplicating or resurrecting a removed token', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    const token = { id: 'annotation-1', kind: 'webviewAnnotation' as const, label: 'Old', promptText: 'Old note' }
    adapter.insertText('Before ')
    adapter.insertToken!(token)
    adapter.insertText('after')
    const selection = editor.state.selection.toJSON()

    updateComposerToken(editor, { ...token, label: 'Revised', promptText: 'Revised note' })

    const draft = serializeComposerDocument(editor)
    expect(draft.text).toBe('Before Revised note after')
    expect(draft.tokens).toMatchObject([{ id: 'annotation-1', label: 'Revised', promptText: 'Revised note' }])
    expect(draft.tokens).toHaveLength(1)
    expect(editor.state.selection.toJSON()).toEqual(selection)

    editor.commands.clearContent()
    updateComposerToken(editor, token)
    expect(serializeComposerDocument(editor)).toEqual({ text: '', tokens: [] })
  })

  it('turns ${name} into an editable field by default (quick phrases rely on it)', () => {
    const adapter = createComposerInputAdapter(createEditor())

    adapter.insertText('Hello ${name}')

    const draft = serializeComposerDocument(editor!)
    expect(draft.tokens.map((token) => [token.kind, token.label])).toEqual([['promptVariable', 'name']])
  })

  it('keeps ${name} literal when the caller opts out of tokenization', () => {
    const adapter = createComposerInputAdapter(createEditor())

    adapter.insertText('echo ${HOME}', { tokenizeVariables: false })

    editor!.commands.insertContent(' more text')
    const draft = serializeComposerDocument(editor!)
    expect(draft.tokens).toEqual([])
    expect(draft.text).toBe('echo ${HOME} more text')
  })

  it('captures and replaces the live editor selection without tokenizing the transcript', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    adapter.insertText('hello world', { tokenizeVariables: false })
    editor.commands.setTextSelection({ from: 7, to: 12 })

    expect(adapter.captureReplaceRange?.()).toEqual({ from: 7, to: 12 })
    expect(adapter.replaceRange?.({ from: 7, to: 12 }, '${HOME}')).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({ text: 'hello ${HOME}', tokens: [] })
    editor.commands.insertContent(' and ${name}')
    const draft = serializeComposerDocument(editor)
    expect(draft.text).toBe('hello ${HOME} and ${name}')
    expect(draft.tokens.map((token) => token.label)).toEqual(['name'])
  })

  it('restores literal dictation through undo and redo without creating variable tokens', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    expect(adapter.replaceRange?.({ from: 1, to: 1 }, '${HOME}')).toBe(true)
    editor.commands.undo()
    expect(serializeComposerDocument(editor)).toEqual({ text: '', tokens: [] })
    editor.commands.redo()
    expect(serializeComposerDocument(editor)).toEqual({ text: '${HOME}', tokens: [] })
  })

  it('re-reads the selection at replacement time and preserves adjacent composer tokens', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    const token = {
      id: 'annotation-1',
      kind: 'webviewAnnotation' as const,
      label: 'Reference',
      promptText: 'REFERENCE'
    }
    adapter.insertText('before ', { tokenizeVariables: false })
    adapter.insertToken!(token, { insertSeparator: false })
    adapter.insertText(' after', { tokenizeVariables: false })

    let tokenPosition = -1
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'composerToken') tokenPosition = position
    })
    editor.commands.setTextSelection({ from: tokenPosition + 1, to: tokenPosition + 7 })

    expect(adapter.replaceRange?.(adapter.captureReplaceRange!()!, ' changed')).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({
      text: 'before REFERENCE changed',
      tokens: [expect.objectContaining({ id: 'annotation-1', textOffset: 7 })]
    })
  })

  it('rejects stale ranges outside the current document', () => {
    const adapter = createComposerInputAdapter(createEditor())
    adapter.insertText('short', { tokenizeVariables: false })

    expect(adapter.replaceRange?.({ from: 5, to: 10 }, 'ignored')).toBe(false)
    expect(serializeComposerDocument(editor!)).toEqual({ text: 'short', tokens: [] })
  })

  it('counts normalized literal text and adjacent token prompts at the draft limit', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    const prefix = 'a'.repeat(COMPOSER_INPUT_MAX_LENGTH - 19)
    adapter.insertText(prefix, { tokenizeVariables: false })
    adapter.insertToken!(
      { id: 'reference', kind: 'webviewAnnotation', label: 'Reference', promptText: 'REFERENCE' },
      { insertSeparator: false }
    )
    adapter.insertText('0123456789', { tokenizeVariables: false })
    const tokens = serializeComposerDocument(editor).tokens

    expect(
      adapter.replaceRange!(
        { from: editor.state.doc.content.size - 11, to: editor.state.doc.content.size - 1 },
        '${HOME}\r\nOK'
      )
    ).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({ text: prefix + 'REFERENCE${HOME}\nOK', tokens })
  })

  it('rejects a replacement above the serialized limit without changing the draft or selection', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    adapter.insertText('a'.repeat(COMPOSER_INPUT_MAX_LENGTH - 19), { tokenizeVariables: false })
    adapter.insertToken!(
      { id: 'reference', kind: 'webviewAnnotation', label: 'Reference', promptText: 'REFERENCE' },
      { insertSeparator: false }
    )
    adapter.insertText('0123456789', { tokenizeVariables: false })
    editor.commands.setTextSelection({ from: 2, to: 5 })
    const draft = serializeComposerDocument(editor)
    const selection = editor.state.selection.toJSON()

    expect(
      adapter.replaceRange!(
        { from: editor.state.doc.content.size - 11, to: editor.state.doc.content.size - 1 },
        '${HOME}\r\nOK!'
      )
    ).toBe(false)
    expect(serializeComposerDocument(editor)).toEqual(draft)
    expect(editor.state.selection.toJSON()).toEqual(selection)
  })

  it('reports the selected text end to toolbar-opened quick panels', () => {
    const currentEditor = createEditor()
    currentEditor.commands.setContent('prefix selected suffix')
    currentEditor.commands.setTextSelection({ from: 8, to: 16 })

    const adapter = createComposerInputAdapter(currentEditor)

    expect(adapter.getCursorOffset?.()).toBe(7)
    expect(adapter.getSelectionEndOffset?.()).toBe(15)
  })
})
