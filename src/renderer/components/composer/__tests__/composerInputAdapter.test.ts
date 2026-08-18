import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { serializeComposerDocument } from '../composerDraft'
import { createComposerInputAdapter } from '../composerInputAdapter'
import { createComposerEditorPreset } from '../composerPreset'
import { insertMcpPromptSegments } from '../tools/definitions/mcpPromptTool'

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

describe('insertMcpPromptSegments through the real adapter', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  it('makes a field of the declared argument only, leaving the server’s own ${...} as text', () => {
    editor = new Editor({ extensions: createComposerEditorPreset({}), content: '' })

    insertMcpPromptSegments(
      [
        { type: 'text', value: 'Review in ' },
        { type: 'argument', name: 'language' },
        { type: 'text', value: ', then run echo ${HOME} and ${{ github.sha }}' }
      ],
      createComposerInputAdapter(editor)
    )

    const draft = serializeComposerDocument(editor)
    // Exactly one field, and it is the argument the prompt declared — not the shell or Actions
    // expression the server wrote, which stay literal text.
    expect(draft.tokens.map((token) => [token.kind, token.label])).toEqual([['promptVariable', 'language']])
    expect(draft.text).toContain('echo ${HOME}')
    expect(draft.text).toContain('${{ github.sha }}')
  })

  it('reproduces the server’s text exactly, with no separator inserted around a chip', () => {
    editor = new Editor({ extensions: createComposerEditorPreset({}), content: '' })

    insertMcpPromptSegments(
      [
        { type: 'text', value: 'Hello ' },
        { type: 'argument', name: 'name' },
        { type: 'text', value: '! Ping ' },
        { type: 'argument', name: 'other' },
        { type: 'text', value: '.' }
      ],
      createComposerInputAdapter(editor)
    )

    // An appended separator would render `Hello ${name} !` and `${name} ${other}` here.
    expect(serializeComposerDocument(editor).text).toBe('Hello ${name}! Ping ${other}.')
  })
})
