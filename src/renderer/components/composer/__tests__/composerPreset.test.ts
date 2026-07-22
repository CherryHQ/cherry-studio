import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createComposerEditorPreset } from '../composerPreset'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'

describe('createComposerEditorPreset', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  it('uses the minimal composer schema instead of document markdown extensions', () => {
    const extensionNames = createComposerEditorPreset({ placeholder: 'Message' }).map((extension) => extension.name)

    expect(extensionNames).toEqual([
      'doc',
      'paragraph',
      'text',
      'hardBreak',
      'placeholder',
      COMPOSER_TOKEN_NODE_NAME,
      'composerUndoRedo'
    ])
    expect(extensionNames).not.toContain('bold')
    expect(extensionNames).not.toContain('bulletList')
    expect(extensionNames).not.toContain('heading')
    expect(extensionNames).not.toContain('table')
  })

  it('can omit undo redo for memory-sensitive composer surfaces', () => {
    const extensionNames = createComposerEditorPreset({ enableUndoRedo: false }).map((extension) => extension.name)

    expect(extensionNames).not.toContain('composerUndoRedo')
  })

  it('adds composer suggestion plugins only when suggestion sources are provided', () => {
    const extensionNames = createComposerEditorPreset({
      suggestionSources: [
        {
          pluginKey: 'test-suggestion',
          char: '/',
          items: () => [
            {
              id: 'test',
              label: 'Test',
              icon: '',
              command: () => undefined
            }
          ]
        }
      ]
    }).map((extension) => extension.name)

    expect(extensionNames).toContain('composerSuggestion')
  })

  it.each(['Enter', 'NumpadEnter'])('inserts a hard break for plain %s instead of splitting the paragraph', (key) => {
    const scrolledIntoView: boolean[] = []
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset({ enableUndoRedo: false }),
      content: '<p>first line</p>'
    })
    editor.commands.focus('end', { scrollIntoView: false })
    editor.on('transaction', ({ transaction }) => scrolledIntoView.push(transaction.scrolledIntoView))

    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'first line' }, { type: 'hardBreak' }]
        }
      ]
    })
    expect(scrolledIntoView).toContain(true)
  })
})
