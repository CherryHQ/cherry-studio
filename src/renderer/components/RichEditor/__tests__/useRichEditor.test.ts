import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCodeTheme: 'one-light' })
}))

import { useRichEditor } from '../useRichEditor'

// Tiptap defers editor destruction; finish it before JSDOM tears down window listeners.
afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 1))
})

const CONTENT = 'hello world'

function getEditor(result: { current: { editor: Editor | null } }): Editor {
  const editor = result.current.editor
  if (!editor) throw new Error('Editor is not ready')
  return editor
}

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
  return event
}

// `imagePlaceholder` counts too: it renders a click target that runs `setImage`, so leaking one into
// an images-off editor reopens the very path the strip is meant to close.
// An HTML-only clipboard: no `text/plain` flavor at all. Browsers' own copy always writes both, but
// a programmatic `ClipboardItem({'text/html': ...})` does not. `withImageItem` adds an `image/*`
// entry alongside, the multi-MIME shape apps produce when copying a region containing an image.
const pasteHtml = (editor: Editor, html: string, { withImageItem = false } = {}) => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/html' ? html : ''),
      items: withImageItem ? [{ type: file.type, getAsFile: () => file }] : []
    }
  })
  editor.view.dom.dispatchEvent(event)
}

const countImageNodes = (editor: Editor): number => {
  let count = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' || node.type.name === 'imagePlaceholder') count += 1
  })
  return count
}

// Mirrors ProseMirror's external-drag path: with no `view.dragging` the slice is parsed from the
// drag event's `text/html`. `posAtCoords` needs stubbing because jsdom reports no layout.
const dropHtml = (editor: Editor, html: string) => {
  editor.view.posAtCoords = () => ({ pos: editor.state.doc.content.size, inside: -1 })
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (type: string) => (type === 'text/html' ? html : ''), files: [], types: ['text/html'] }
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
  it('refocuses the end when the editor becomes editable and autoFocus is enabled', async () => {
    const { result, rerender } = renderHook(({ editable }) => useRichEditor({ initialContent: CONTENT, editable }), {
      initialProps: { editable: false }
    })

    act(() => {
      getEditor(result).commands.setTextSelection(1)
    })
    expect(isSelectionAtEnd(getEditor(result))).toBe(false)

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(getEditor(result).isEditable).toBe(true)
    expect(isSelectionAtEnd(getEditor(result))).toBe(true)
  })

  it('keeps the selection at the start on mount and when enabling editing with autofocus off', async () => {
    const { result, rerender } = renderHook(
      ({ editable }) => useRichEditor({ initialContent: CONTENT, editable, autoFocus: false }),
      { initialProps: { editable: false } }
    )

    await flushFocusTimeout()
    expect(getEditor(result).getText()).toBe(CONTENT)
    expect(getEditor(result).state.selection.from).toBe(Selection.atStart(getEditor(result).state.doc).from)

    rerender({ editable: true })
    await flushFocusTimeout()

    expect(getEditor(result).isEditable).toBe(true)
    expect(isSelectionAtEnd(getEditor(result))).toBe(false)
  })
})

describe('useRichEditor markdown paste', () => {
  it('renders block markdown with carriage-return line endings pasted into an existing paragraph', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: 'before', autoFocus: false }))
    await act(async () => {
      getEditor(result).commands.setTextSelection(7)
      pastePlainText(getEditor(result), '| a | b |\r| --- | --- |\r| 1 | 2 |\r\r```ts\rconst value = 1\r```')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const nodeTypes = getEditor(result)
      .getJSON()
      .content?.map((node) => node.type)
    expect(nodeTypes).toContain('table')
    expect(nodeTypes).toContain('codeBlock')
  })

  it.each([
    ['/tmp/notes with spaces/paste #1.png', 'file:///tmp/notes%20with%20spaces/paste%20%231.png'],
    ['/tmp/notes )private/paste.png', 'file:///tmp/notes%20%29private/paste.png'],
    ['C:\\Notes Folder\\paste #1.png', 'file:///C:/Notes%20Folder/paste%20%231.png']
  ])('reopens a pasted managed image stored at %s', async (path, url) => {
    vi.mocked(window.api.file.createInternalEntry).mockResolvedValue({
      id: 'entry-1',
      name: 'Pasted Image',
      ext: 'png'
    } as never)
    vi.mocked(window.api.file.getPhysicalPath).mockResolvedValue(AbsoluteFilePathSchema.parse(path))

    const onChange = vi.fn<(markdown: string) => void>()
    const { result, unmount } = renderHook(() => useRichEditor({ initialContent: '', autoFocus: false, onChange }))

    await act(async () => {
      const editor = getEditor(result)
      editor.view.dom.dispatchEvent(new FocusEvent('focus'))
      pasteImage(editor)
    })
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toContain(url))
    const savedMarkdown = onChange.mock.lastCall![0]
    unmount()

    const reopened = renderHook(() => useRichEditor({ initialContent: savedMarkdown, autoFocus: false }))
    expect(getEditor(reopened.result).getJSON().content).toContainEqual(
      expect.objectContaining({ type: 'image', attrs: expect.objectContaining({ src: url }) })
    )
    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'bytes', cleanupPolicy: 'manual' })
    )
  })

  it('keeps clipboard images out without losing accompanying text when images are disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      pasteImage(getEditor(result))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
    expect(
      getEditor(result)
        .getJSON()
        .content?.some((node) => node.type === 'image')
    ).toBe(false)

    await act(async () => {
      pasteImage(getEditor(result), 'clipboard text')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
    expect(
      getEditor(result)
        .getJSON()
        .content?.some((node) => node.type === 'image')
    ).toBe(false)
    expect(getEditor(result).getText()).toBe('clipboard text')
  })

  it('preserves text from HTML image pastes with or without an image item', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      pasteHtml(getEditor(result), '<p>plain caption <img src="https://example.com/image.png" alt="alt"></p>')
      // Copying a region with an image yields both an `image/*` item and rich HTML; keying the
      // swallow off the item alone throws the caption away with it.
      pasteHtml(getEditor(result), '<p>item caption <img src="https://example.com/image.png"></p>', {
        withImageItem: true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toContain('plain caption')
    expect(getEditor(result).getText()).toContain('item caption')
  })

  it('leaves a selection intact when an image item arrives with image-only HTML', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: 'hello world', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      const { state } = getEditor(result).view
      getEditor(result).view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)))
    })
    await act(async () => {
      pasteHtml(getEditor(result), '<img src="https://example.com/image.png">', { withImageItem: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toBe('hello world')
  })

  it('leaves a selection intact when the clipboard HTML text sits only in tags ProseMirror ignores', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: 'hello world', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      const { state } = getEditor(result).view
      getEditor(result).view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)))
    })
    await act(async () => {
      // An HTML email body carries its `<style>` along with the copied image. That text reaches
      // `textContent` but never the parsed slice, so measuring the DOM instead of the slice would
      // call this "text worth keeping" and fall through onto an empty insert.
      pasteHtml(getEditor(result), '<img src="https://example.com/image.png"><style>td {border: 0;}</style>', {
        withImageItem: true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(getEditor(result).getText()).toBe('hello world')
  })

  it('consumes a bare image clipboard pasted over a selection', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: 'hello world', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      const { state } = getEditor(result).view
      getEditor(result).view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)))
    })
    let event: Event | undefined
    await act(async () => {
      // A screenshot clipboard is `image/png` alone — no HTML, no text. jsdom cannot run the
      // browser's native paste, so consuming the event is the only observable of the thing that
      // stops it from dropping a blob-URL <img> over the selection.
      event = pasteImage(getEditor(result))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(event?.defaultPrevented).toBe(true)
    expect(getEditor(result).getText()).toBe('hello world')
  })

  it('leaves a selection intact when an image-only HTML clipboard is pasted over it', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: 'hello world', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      const { state } = getEditor(result).view
      getEditor(result).view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)))
    })
    await act(async () => {
      pasteHtml(getEditor(result), '<img src="https://example.com/image.png" alt="alt">')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // A paste that inserts nothing must also destroy nothing: falling through here would have
    // ProseMirror replace the selection with the emptied slice.
    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toBe('hello world')
  })

  it('does not turn pasted markdown image syntax into an image when images are disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      pastePlainText(getEditor(result), '![alt](https://example.com/image.png)')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(
      getEditor(result)
        .getJSON()
        .content?.some((node) => node.type === 'image')
    ).toBe(false)
  })

  it('keeps typed markdown image syntax as text when image insertion is disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      typeText(getEditor(result), '![alt](https://example.com/image.png)')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(
      getEditor(result)
        .getJSON()
        .content?.some((node) => node.type === 'image')
    ).toBe(false)
    expect(getEditor(result).getText()).toBe('![alt](https://example.com/image.png)')
  })
})

describe('useRichEditor accessibility', () => {
  it('names the editing surface when the caller has no visible label', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: '', autoFocus: false, ariaLabel: 'Content' }))

    expect(getEditor(result).view.dom.getAttribute('aria-label')).toBe('Content')
  })
})

describe('useRichEditor image drag and drop', () => {
  it('keeps an image dragged in as HTML out of the document while preserving its text', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      dropHtml(getEditor(result), '<p>caption <img src="https://example.com/image.png" alt="alt"></p>')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toContain('caption')
  })

  it('inserts nothing when the dragged HTML is only an image', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: 'before', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      dropHtml(getEditor(result), '<img src="https://example.com/image.png" alt="alt">')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toBe('before')
  })

  it('strips a dragged image placeholder when image insertion is disabled', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      dropHtml(getEditor(result), '<p>keep</p><div data-type="image-placeholder"></div>')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toContain('keep')
  })

  it('leaves the document schema-valid when a dropped table cell held only an image', async () => {
    const { result } = renderHook(() =>
      useRichEditor({ initialContent: '', autoFocus: false, enableImageInsertion: false })
    )

    await act(async () => {
      dropHtml(
        getEditor(result),
        '<table><tbody><tr><td><img src="https://example.com/image.png"></td><td>text</td></tr></tbody></table>'
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(0)
    expect(getEditor(result).getText()).toContain('text')
    expect(() => getEditor(result).state.doc.check()).not.toThrow()
  })

  it('still accepts a dragged image when image insertion is enabled', async () => {
    const { result } = renderHook(() => useRichEditor({ initialContent: '', autoFocus: false }))

    await act(async () => {
      dropHtml(getEditor(result), '<p><img src="https://example.com/image.png" alt="alt"></p>')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(countImageNodes(getEditor(result))).toBe(1)
  })
})
