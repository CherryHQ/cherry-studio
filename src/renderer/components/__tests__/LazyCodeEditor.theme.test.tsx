import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { EditorView } from '@uiw/react-codemirror'
import { beforeEach, expect, it, vi } from 'vitest'

import { codeBlockHighlightStyle } from '@cherrystudio/ui/code-block'

import { CodeStyleProvider } from '../CodeStyleProvider'
import { LazyCodeEditor } from '../LazyCodeEditor'

vi.unmock('@cherrystudio/ui')
const appearance = vi.hoisted(() => ({ theme: 'light' }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => appearance }))

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  appearance.theme = 'light'
})

// Generic editors must retain their saved theme while adopted message editors use the supplied palette.
it('resolves separate CodeMirror themes without resetting the document, selection or undo history', async () => {
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.editor.enabled': false,
    'chat.code.viewer.theme_light': 'one-light',
    'chat.code.editor.theme_light': 'dracula',
    'chat.code.editor.theme_dark': 'light'
  })
  const surface = () => (
    <CodeStyleProvider>
      <LazyCodeEditor value="const answer = 42" language="javascript" />
      <LazyCodeEditor
        value="const answer = 42"
        language="javascript"
        theme="light"
        syntaxHighlightStyle={codeBlockHighlightStyle}
      />
    </CodeStyleProvider>
  )
  const host = render(surface())
  const editors = () =>
    Array.from(host.container.querySelectorAll<HTMLElement>('.cm-editor'), (node) => EditorView.findFromDOM(node)!)
  await waitFor(() => {
    expect(editors()).toHaveLength(2)
    expect(editors()[0].state.facet(EditorView.darkTheme)).toBe(true)
    expect(editors()[1].state.facet(EditorView.darkTheme)).toBe(false)
  })
  act(() => editors()[0].dispatch({ changes: { from: 17, insert: ' draft' }, selection: { anchor: 18, head: 23 } }))
  appearance.theme = 'dark'
  host.rerender(surface())
  await waitFor(() => expect(editors()[0].state.facet(EditorView.darkTheme)).toBe(false))
  expect(editors()[0].state.sliceDoc()).toBe('const answer = 42 draft')
  expect(editors()[0].state.selection.main).toMatchObject({ from: 18, to: 23 })
  fireEvent.keyDown(editors()[0].contentDOM, { key: 'z', ctrlKey: true })
  expect(editors()[0].state.sliceDoc()).toBe('const answer = 42')
})
