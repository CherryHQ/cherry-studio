import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { serializeComposerDocument } from '../composerDraft'
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
})
