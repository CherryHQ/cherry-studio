// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

const mocks = vi.hoisted(() => {
  const replacement = { changes: 'inserted-text' }

  return {
    codeMirrorProps: undefined as { onCreateEditor?: (view: unknown) => void } | undefined,
    dispatch: vi.fn(),
    focus: vi.fn(),
    replacement,
    replaceSelection: vi.fn(() => replacement),
    scrollToLine: vi.fn()
  }
})

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { onCreateEditor?: (view: unknown) => void }) => {
    mocks.codeMirrorProps = props
    props.onCreateEditor?.({
      dispatch: mocks.dispatch,
      focus: mocks.focus,
      scrollDOM: { scrollHeight: 120 },
      state: {
        doc: {
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
})
