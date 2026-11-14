import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ComposerSuggestionActiveChangeOptions,
  createComposerSuggestionExtension
} from '../quickPanel/suggestionExtension'

describe('composer suggestion dismissal sessions', () => {
  let editor: Editor

  afterEach(() => editor?.destroy())

  function createEditor() {
    const changes: ComposerSuggestionActiveChangeOptions[] = []
    editor = new Editor({
      extensions: [
        StarterKit,
        createComposerSuggestionExtension([
          {
            pluginKey: 'session-dismissal',
            char: '@',
            items: () => [],
            onActiveChange: (options) => changes.push(options)
          }
        ])
      ]
    })
    return changes
  }

  const activeDecoration = () => editor.view.dom.querySelector('[data-decoration-id]')

  it('ignores a closed session callback after reopening at the same query and position', async () => {
    const changes = createEditor()
    editor.commands.insertContent('@')
    await vi.waitFor(() => expect(changes).toHaveLength(1))
    const oldPanel = changes[0]
    oldPanel.exit()
    expect(activeDecoration()).toBeNull()

    editor.commands.clearContent()
    editor.commands.insertContent('@')
    await vi.waitFor(() => expect(changes).toHaveLength(2))
    expect(activeDecoration()).not.toBeNull()

    oldPanel.exit()
    expect(activeDecoration()).not.toBeNull()
    expect(editor.getText()).toBe('@')
    changes[1].exit()
    expect(activeDecoration()).toBeNull()
    expect(editor.getText()).toBe('@')
  })

  it('does not dismiss a different trigger after moving directly between active occurrences', async () => {
    const changes = createEditor()
    editor.commands.insertContent('@first @second')
    await vi.waitFor(() => expect(changes).toHaveLength(1))
    const oldPanel = changes[0]
    expect(oldPanel.query).toBe('second')

    editor.commands.setTextSelection(7)
    await vi.waitFor(() => expect(changes).toHaveLength(2))
    expect(changes[1].query).toBe('first')

    oldPanel.exit()
    expect(activeDecoration()).not.toBeNull()
    expect(editor.getText()).toBe('@first @second')
    changes[1].exit()
    expect(activeDecoration()).toBeNull()
    expect(editor.getText()).toBe('@first @second')
  })
})
