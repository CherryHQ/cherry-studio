import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from '../composerDraft'
import { createComposerInputAdapter, updateComposerToken } from '../composerInputAdapter'
import { createComposerEditorPreset } from '../composerPreset'

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

  it('captures and replaces the live plain-text selection without tokenizing the transcript', () => {
    const editor = createEditor()
    const adapter = createComposerInputAdapter(editor)
    adapter.insertText('hello world', { tokenizeVariables: false })
    editor.commands.setTextSelection({ from: 7, to: 12 })

    expect(adapter.captureReplaceRange?.()).toEqual({ from: 6, to: 11 })
    expect(adapter.replaceRange?.({ from: 6, to: 11 }, '${HOME}')).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({ text: 'hello ${HOME}', tokens: [] })
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

    expect(adapter.captureReplaceRange?.()).toEqual({ from: 16, to: 22 })
    expect(adapter.replaceRange?.(adapter.captureReplaceRange!()!, ' changed')).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({
      text: 'before REFERENCE changed',
      tokens: [expect.objectContaining({ id: 'annotation-1', textOffset: 7 })]
    })
  })

  it('rejects stale ranges outside the current projected text', () => {
    const adapter = createComposerInputAdapter(createEditor())
    adapter.insertText('short', { tokenizeVariables: false })

    expect(adapter.replaceRange?.({ from: 5, to: 6 }, 'ignored')).toBe(false)
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
      adapter.replaceRange!({ from: COMPOSER_INPUT_MAX_LENGTH - 10, to: COMPOSER_INPUT_MAX_LENGTH }, '${HOME}\r\nOK')
    ).toBe(true)
    expect(serializeComposerDocument(editor)).toEqual({ text: prefix + 'REFERENCE${HOME}\nOK', tokens })
    expect(adapter.captureReplaceRange!()).toEqual({ from: COMPOSER_INPUT_MAX_LENGTH, to: COMPOSER_INPUT_MAX_LENGTH })
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
      adapter.replaceRange!({ from: COMPOSER_INPUT_MAX_LENGTH - 10, to: COMPOSER_INPUT_MAX_LENGTH }, '${HOME}\r\nOK!')
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
