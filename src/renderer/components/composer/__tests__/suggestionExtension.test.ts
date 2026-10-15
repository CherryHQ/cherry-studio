import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  COMPOSER_SUPPRESS_SUGGESTION_META,
  type ComposerSuggestionActiveChangeOptions,
  type ComposerSuggestionItem,
  createComposerSuggestionExtension
} from '../quickPanel/suggestionExtension'

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

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

  it('ignores suggestion items that finish after a newer query', async () => {
    const firstItems = createDeferred<never[]>()
    const secondItems = createDeferred<never[]>()
    const onActiveChange = vi.fn()
    const items = vi.fn(({ query }: { query: string }) => {
      return query === 'a' ? firstItems.promise : secondItems.promise
    })

    editor = new Editor({
      extensions: [
        StarterKit,
        createComposerSuggestionExtension([
          {
            pluginKey: 'test-resource-suggestion',
            char: '@',
            allowedPrefixes: [' ', '\n'],
            onActiveChange,
            items
          }
        ])
      ],
      content: '<p></p>'
    })

    editor.chain().insertContent('@a').run()
    await vi.waitFor(() => expect(items).toHaveBeenCalledWith(expect.objectContaining({ query: 'a' })))

    editor.chain().insertContent('b').run()
    await vi.waitFor(() => expect(items).toHaveBeenCalledWith(expect.objectContaining({ query: 'ab' })))

    secondItems.resolve([])
    await vi.waitFor(() => expect(onActiveChange).toHaveBeenCalledWith(expect.objectContaining({ query: 'ab' })))

    firstItems.resolve([])
    await waitForSuggestionUpdate()

    expect(onActiveChange.mock.calls.map(([options]) => options.query)).toEqual(['ab'])
  })

  it.each(['edit', 'exit', 'destroy'])('discards a pending external refresh after %s', async (action) => {
    const pending = createDeferred<ComposerSuggestionItem[]>()
    const item = { id: 'readme', label: 'readme.md', command: () => undefined }
    const onActiveChange = vi.fn<(options: ComposerSuggestionActiveChangeOptions) => void>()
    const items = vi.fn().mockResolvedValueOnce([item]).mockReturnValueOnce(pending.promise).mockResolvedValue([])
    editor = new Editor({
      extensions: [
        StarterKit,
        createComposerSuggestionExtension([
          {
            pluginKey: 'test-resource-suggestion',
            char: '@',
            items,
            onActiveChange
          }
        ])
      ],
      content: '<p></p>'
    })
    editor.commands.insertContent('@r')
    await vi.waitFor(() => expect(onActiveChange).toHaveBeenCalled())
    const refresh = onActiveChange.mock.lastCall![0].refreshItems!()
    if (action === 'edit') editor.commands.insertContent('e')
    if (action === 'exit') editor.commands.clearContent()
    if (action === 'destroy') editor.destroy()
    pending.resolve([item])
    await expect(refresh).resolves.toBeUndefined()
  })

  it('does not notify after pending suggestion items outlive the editor', async () => {
    const pendingItems = createDeferred<never[]>()
    const onActiveChange = vi.fn()
    const items = vi.fn(() => pendingItems.promise)

    editor = new Editor({
      extensions: [
        StarterKit,
        createComposerSuggestionExtension([
          {
            pluginKey: 'test-resource-suggestion',
            char: '@',
            allowedPrefixes: [' ', '\n'],
            onActiveChange,
            items
          }
        ])
      ],
      content: '<p></p>'
    })

    editor.chain().insertContent('@notes').run()
    await vi.waitFor(() => expect(items).toHaveBeenCalledWith(expect.objectContaining({ query: 'notes' })))

    editor.destroy()
    pendingItems.resolve([])
    await waitForSuggestionUpdate()

    expect(onActiveChange).not.toHaveBeenCalled()
  })
})
