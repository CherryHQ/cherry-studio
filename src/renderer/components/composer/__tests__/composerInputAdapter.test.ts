import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { createComposerDraftContent, serializeComposerDocument } from '../composerDraft'
import { appendComposerText, createComposerInputAdapter, updateComposerToken } from '../composerInputAdapter'
import { createComposerEditorPreset } from '../composerPreset'
import { createEditableMessageDraft, replaceEditedMessageParts } from '../variants/chat/messageEditingDraft'

describe('createComposerInputAdapter', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function createEditor() {
    editor = new Editor({ extensions: createComposerEditorPreset({}), content: '' })
    return editor
  }

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

    const draft = serializeComposerDocument(editor!)
    expect(draft.tokens).toEqual([])
    expect(draft.text).toBe('echo ${HOME}')
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
