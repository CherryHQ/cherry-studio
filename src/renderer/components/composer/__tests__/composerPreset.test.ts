import { describe, expect, it } from 'vitest'

import { createComposerEditorPreset } from '../composerPreset'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'

describe('createComposerEditorPreset', () => {
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
})
