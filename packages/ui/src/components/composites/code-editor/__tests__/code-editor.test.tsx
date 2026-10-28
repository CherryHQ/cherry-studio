// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CodeEditor from '../code-editor'
import type { CodeEditorHandles } from '../types'

describe('CodeEditor public interaction', () => {
  it('inserts literal text at the current selection and focuses the editor', async () => {
    const handle: { current: CodeEditorHandles | null } = { current: null }
    const { container } = render(<CodeEditor ref={handle} value="alpha beta" language="text" />)
    await waitFor(() => expect(handle.current?.getContent?.()).toBe('alpha beta'))
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!
    act(() => view.dispatch({ selection: { anchor: 6, head: 10 } }))
    act(() => {
      expect(handle.current?.insertText?.('你好 🥟')).toBe(true)
    })
    expect(handle.current?.getContent?.()).toBe('alpha 你好 🥟')
    expect(view.hasFocus).toBe(true)
  })

  it('focuses the real editor when autofocus is requested', async () => {
    const { container } = render(<CodeEditor autoFocus value="source" language="text" />)
    await waitFor(() => expect(EditorView.findFromDOM(container.querySelector('.cm-editor')!)?.hasFocus).toBe(true))
  })

  it.each([
    { expanded: false, height: '100%', style: undefined, expected: '100%' },
    { expanded: true, height: '100%', style: undefined, expected: '' },
    { expanded: false, height: '100%', style: { height: '300px' }, expected: '300px' }
  ])('keeps the host sizing contract for $expected', ({ expanded, height, style, expected }) => {
    const { container } = render(
      <CodeEditor value="source" language="text" expanded={expanded} height={height} style={style} />
    )
    expect(container.querySelector<HTMLElement>('.code-editor')?.style.height).toBe(expected)
  })
})
