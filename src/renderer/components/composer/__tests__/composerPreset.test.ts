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
      'composerActivityIndicator',
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

  it('renders a trailing activity indicator without changing the composer document', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset({ enableUndoRedo: false }),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Translate me  ' }] }]
      }
    })
    const documentBeforeIndicator = editor.getJSON()

    editor.commands.setComposerActivityIndicator('Translating')

    const indicator = editor.view.dom.querySelector('[data-composer-activity-indicator]')
    expect(indicator).toHaveAttribute('role', 'status')
    expect(indicator).toHaveAttribute('aria-label', 'Translating')
    expect(indicator).toHaveAttribute('contenteditable', 'false')
    expect(indicator?.previousSibling?.textContent).toBe('Translate me')
    expect(indicator?.nextSibling?.textContent).toBe('  ')
    expect(editor.getJSON()).toEqual(documentBeforeIndicator)

    editor.commands.setComposerActivityIndicator()

    expect(editor.view.dom.querySelector('[data-composer-activity-indicator]')).toBeNull()
    expect(editor.getJSON()).toEqual(documentBeforeIndicator)
  })

  // Which Enter combination inserts a hard break is a user preference resolved in
  // ComposerSurfaceRuntime, so the key routing is covered by ComposerSurface.test.tsx.
  it('inserts a hard break without splitting the paragraph', () => {
    const scrolledIntoView: boolean[] = []
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createComposerEditorPreset({ enableUndoRedo: false }),
      content: '<p>first line</p>'
    })
    editor.commands.focus('end', { scrollIntoView: false })
    editor.on('transaction', ({ transaction }) => scrolledIntoView.push(transaction.scrolledIntoView))

    editor.commands.setHardBreak()

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
