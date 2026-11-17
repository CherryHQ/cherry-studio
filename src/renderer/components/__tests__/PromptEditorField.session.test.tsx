import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@uiw/react-codemirror'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodeStyleProvider } from '../CodeStyleProvider'
import PromptEditorField from '../PromptEditorField'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/components/markdown', () => ({
  StaticMarkdown: ({ children }: { children: string }) => <pre>{children}</pre>
}))

// Toggling preview must retain the user's draft, selection and undo history after controlled-value echoes.
describe('PromptEditorField session', () => {
  it('retains edits across preview while an external replacement starts a fresh document', async () => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.message.font_size': 14,
      'chat.code.viewer.theme_light': 'one-light'
    })
    function Host() {
      const [value, setValue] = useState('Original {{name}}')
      return (
        <CodeStyleProvider>
          <button type="button" onClick={() => setValue('External replacement')}>
            Replace prompt
          </button>
          <PromptEditorField label="Prompt" value={value} onChange={setValue} />
        </CodeStyleProvider>
      )
    }
    const host = render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    const editor = () => EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
    act(() => editor().dispatch({ changes: { from: 17, insert: ' draft' }, selection: { anchor: 18, head: 23 } }))
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.getByText('Original {{name}} draft')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    expect(editor().state.sliceDoc()).toBe('Original {{name}} draft')
    expect(editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to)).toBe('draft')
    act(() => {
      fireEvent.keyDown(editor().contentDOM, { key: 'z', ctrlKey: true })
    })
    expect(editor().state.sliceDoc()).toBe('Original {{name}}')
    fireEvent.click(screen.getByRole('button', { name: 'Replace prompt' }))
    await waitFor(() => expect(editor().state.sliceDoc()).toBe('External replacement'))
    act(() => {
      fireEvent.keyDown(editor().contentDOM, { key: 'z', ctrlKey: true })
    })
    expect(editor().state.sliceDoc()).toBe('External replacement')
  })
})
