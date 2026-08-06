import { act, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import { useRichEditor } from '../useRichEditor'

const CONTENT = 'hello world'

// focus('end') dispatches a selection transaction even when jsdom cannot deliver real DOM focus,
// so the selection position is the reliable observable for the autoFocus gating.
const isSelectionAtEnd = (editor: Editor): boolean => editor.state.selection.eq(Selection.atEnd(editor.state.doc))

const flushFocusTimeout = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const pastePlainText = (editor: Editor, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: []
    }
  })
  editor.view.dom.dispatchEvent(event)
}

const pasteImage = (editor: Editor, text = '') => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: [{ type: file.type, getAsFile: () => file }]
    }
  })
  editor.view.dom.dispatchEvent(event)
}

const typeText = (editor: Editor, text: string) => {
  for (const character of text) {
    const { from, to } = editor.state.selection
    let handled = false
    editor.view.someProp('handleTextInput', (handler) => {
      handled =
        handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to)) === true
      return handled
    })
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(character, from, to))
    }
  }
}

beforeEach(() => {
  Object.assign(window.api.file, {
    createInternalEntry: vi.fn(),
    getPhysicalPath: vi.fn()
  })
})

describe('useRichEditor autoFocus', () => {
  it('focuses the end of the document on mount by default', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: CONTENT }))
    await flushFocusTimeout()

    expect(result.current.editor.getText()).toBe(CONTENT)
    expect(isSelectionAtEnd(result.current.editor)).toBe(true)
  })

  it('leaves the selection at the start on mount when autoFocus is false', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: CONTENT, autoFocus: false }))
    await flushFocusTimeout()

    expect(result.current.editor.getText()).toBe(CONTENT)
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)
    expect(result.current.editor.state.selection.from).toBe(Selection.atStart(result.current.editor.state.doc).from)
  })

  it('refocuses the end when the editor becomes editable and autoFocus is enabled', async () => {
    const { result, rerender } = renderHook(({ editable }) => useRichEditor({ initialContent: CONTENT, editable }), {
      initialProps: { editable: false }
    })

    act(() => {
      result.current.editor.commands.setTextSelection(1)
    })
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(result.current.editor.isEditable).toBe(true)
    expect(isSelectionAtEnd(result.current.editor)).toBe(true)
  })

  it('keeps the selection when the editor becomes editable and autoFocus is false', async () => {
    const { result, rerender } = renderHook(
      ({ editable }) => useRichEditor({ initialContent: CONTENT, editable, autoFocus: false }),
      { initialProps: { editable: false } }
    )

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(result.current.editor.isEditable).toBe(true)
    expect(isSelectionAtEnd(result.current.editor)).toBe(false)
  })
})

describe('useRichEditor markdown paste', () => {
  it('renders block markdown with carriage-return line endings pasted into an existing paragraph', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: 'before', autoFocus: false }))
    await act(async () => {
      result.current.editor.commands.setTextSelection(7)
      pastePlainText(result.current.editor, '| a | b |\r| --- | --- |\r| 1 | 2 |\r\r```ts\rconst value = 1\r```')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const nodeTypes = result.current.editor.getJSON().content?.map((node) => node.type)
    expect(nodeTypes).toContain('table')
    expect(nodeTypes).toContain('codeBlock')
  })

  it('keeps clipboard images out without losing accompanying text when images are disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      pasteImage(result.current.editor)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
    expect(result.current.editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false)

    await act(async () => {
      pasteImage(result.current.editor, 'clipboard text')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
    expect(result.current.editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false)
    expect(result.current.editor.getText()).toBe('clipboard text')
  })

  it('does not turn pasted markdown image syntax into an image when images are disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      pastePlainText(result.current.editor, '![alt](https://example.com/image.png)')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false)
  })

  it('keeps typed markdown image syntax as text when image insertion is disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      typeText(result.current.editor, '![alt](https://example.com/image.png)')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(result.current.editor.getJSON().content?.some((node) => node.type === 'image')).toBe(false)
    expect(result.current.editor.getText()).toBe('![alt](https://example.com/image.png)')
  })
})
