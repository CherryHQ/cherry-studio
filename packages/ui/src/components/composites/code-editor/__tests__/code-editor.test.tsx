// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

const mocks = vi.hoisted(() => {
  const replacement = { changes: 'inserted-text' }
  const scrollEffect = { type: 'scroll-to-bottom' }
  const scrollDOM = {
    addEventListener: vi.fn(),
    clientHeight: 100,
    removeEventListener: vi.fn(),
    scrollHeight: 200,
    scrollTop: 100
  }

  return {
    codeMirrorProps: undefined as { autoFocus?: boolean; onCreateEditor?: (view: unknown) => void } | undefined,
    dispatch: vi.fn(),
    focus: vi.fn(),
    replacement,
    replaceSelection: vi.fn(() => replacement),
    scrollDOM,
    scrollEffect,
    scrollIntoView: vi.fn<(position: number, options: { y: string; x: string }) => typeof scrollEffect>(
      () => scrollEffect
    ),
    scrollListener: undefined as (() => void) | undefined,
    scrollToLine: vi.fn()
  }
})

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { autoFocus?: boolean; onCreateEditor?: (view: unknown) => void }) => {
    mocks.codeMirrorProps = props
    mocks.scrollDOM.addEventListener.mockImplementation((event: string, listener: () => void) => {
      if (event === 'scroll') mocks.scrollListener = listener
    })
    props.onCreateEditor?.({
      dispatch: mocks.dispatch,
      focus: mocks.focus,
      scrollDOM: mocks.scrollDOM,
      state: {
        doc: {
          length: 'Current content'.length,
          toString: () => 'Current content'
        },
        replaceSelection: mocks.replaceSelection
      }
    })

    return <div data-testid="code-editor" />
  },
  Annotation: {
    define: () => ({
      of: (value: boolean) => value
    })
  },
  EditorView: {
    lineWrapping: 'line-wrapping',
    scrollIntoView: mocks.scrollIntoView,
    theme: vi.fn(() => 'editor-theme')
  }
}))

vi.mock('../hooks', () => ({
  useBlurHandler: () => [],
  useHeightListener: () => [],
  useLanguageExtensions: () => [],
  useSaveKeymap: () => [],
  useScrollToLine: () => mocks.scrollToLine
}))

describe('CodeEditor', () => {
  beforeEach(() => {
    mocks.codeMirrorProps = undefined
    mocks.dispatch.mockClear()
    mocks.focus.mockClear()
    mocks.replaceSelection.mockClear()
    mocks.scrollDOM.addEventListener.mockClear()
    mocks.scrollDOM.removeEventListener.mockClear()
    mocks.scrollDOM.clientHeight = 100
    mocks.scrollDOM.scrollHeight = 200
    mocks.scrollDOM.scrollTop = 100
    mocks.scrollIntoView.mockClear()
    mocks.scrollListener = undefined
    mocks.scrollToLine.mockClear()
  })

  it('inserts text at the current CodeMirror selection through the imperative handle', () => {
    let editorRef: React.RefObject<CodeEditorHandles | null> | null = null

    function Harness() {
      const ref = useRef<CodeEditorHandles | null>(null)
      editorRef = ref

      return <CodeEditor ref={ref} value="Current content" language="markdown" />
    }

    render(<Harness />)

    let inserted: boolean | undefined
    act(() => {
      inserted = editorRef?.current?.insertText?.('${variable}')
    })

    expect(inserted).toBe(true)
    expect(mocks.replaceSelection).toHaveBeenCalledWith('${variable}')
    expect(mocks.dispatch).toHaveBeenCalledWith(mocks.replacement)
    expect(mocks.focus).toHaveBeenCalledTimes(1)
  })

  it('delegates autofocus to CodeMirror', () => {
    render(<CodeEditor autoFocus value="" language="markdown" />)

    expect(mocks.codeMirrorProps?.autoFocus).toBe(true)
  })

  it('scrolls the internal editor to the document bottom when streaming content grows', () => {
    const { rerender } = render(
      <CodeEditor
        value="Current content"
        language="markdown"
        options={{ stream: true }}
        expanded={false}
        autoScrollToBottom
      />
    )
    mocks.dispatch.mockClear()
    mocks.scrollIntoView.mockClear()

    rerender(
      <CodeEditor
        value="Current content\nnext line"
        language="markdown"
        options={{ stream: true }}
        expanded={false}
        autoScrollToBottom
      />
    )

    expect(mocks.scrollIntoView).toHaveBeenCalledWith(expect.any(Number), {
      y: 'end',
      x: 'nearest'
    })
    expect(mocks.scrollIntoView.mock.calls[0][0]).toBeGreaterThan('Current content'.length)
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        effects: mocks.scrollEffect
      })
    )
  })

  it('does not force the editor back to bottom after the user scrolls away', () => {
    const { rerender } = render(
      <CodeEditor
        value="Current content"
        language="markdown"
        options={{ stream: true }}
        expanded={false}
        autoScrollToBottom
      />
    )

    mocks.scrollDOM.scrollTop = 20
    mocks.scrollListener?.()
    mocks.dispatch.mockClear()
    mocks.scrollIntoView.mockClear()

    rerender(
      <CodeEditor
        value="Current content\nnext line"
        language="markdown"
        options={{ stream: true }}
        expanded={false}
        autoScrollToBottom
      />
    )

    expect(mocks.scrollIntoView).not.toHaveBeenCalled()
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({
        effects: mocks.scrollEffect
      })
    )
  })
})
