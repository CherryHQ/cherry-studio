import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPOSER_SUPPRESS_SUGGESTION_META, createComposerSuggestionExtension } from '../quickPanel/suggestionExtension'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

const reportedPasteText = "-lc 'exec npx -y @agentclientprotocol/claude-agent-acp'"

describe('createComposerSuggestionExtension', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function createEditor(onActiveChange = vi.fn()) {
    editor = new Editor({
      extensions: [
        StarterKit,
        createComposerSuggestionExtension([
          {
            pluginKey: 'test-resource-suggestion',
            char: '@',
            allowedPrefixes: [' ', '\n'],
            onActiveChange,
            items: () => []
          }
        ])
      ],
      content: '<p></p>'
    })

    return { editor, onActiveChange }
  }

  async function waitForSuggestionUpdate() {
    await Promise.resolve()
    await Promise.resolve()
  }

  it('does not activate suggestions for transactions marked as composer paste insertion', async () => {
    const { editor, onActiveChange } = createEditor()

    editor.chain().setMeta(COMPOSER_SUPPRESS_SUGGESTION_META, true).insertContent(reportedPasteText).run()
    await waitForSuggestionUpdate()

    expect(editor.getText()).toBe(reportedPasteText)
    expect(onActiveChange).not.toHaveBeenCalled()
  })

  it('activates suggestions for normal typed triggers', async () => {
    const { editor, onActiveChange } = createEditor()

    editor.chain().insertContent('@readme').run()
    await waitForSuggestionUpdate()

    expect(onActiveChange).toHaveBeenCalled()
  })
})
