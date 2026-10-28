import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@uiw/react-codemirror'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCodeBlockLanguage } from '@cherrystudio/ui/code-block'

import { CodeBlockView } from '../CodeBlockView'

vi.unmock('@cherrystudio/ui')
const { appearance, t } = vi.hoisted(() => ({ appearance: { isCodeThemeDark: false }, t: (key: string) => key }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCodeStyle: () => appearance }))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre aria-label="Source">{value}</pre>
}))
vi.mock('@renderer/services/PyodideService', () => ({ pyodideService: {} }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t })
}))

beforeEach(async () => {
  await Promise.all([loadCodeBlockLanguage('ts'), loadCodeBlockLanguage('text')])
  appearance.isCodeThemeDark = false
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.editor.enabled': true,
    'chat.code.collapsible': false,
    'chat.code.wrappable': true,
    'chat.code.execution.enabled': false,
    'chat.message.font_size': 14
  })
})

describe('CodeBlockView with the real editor', () => {
  it('keeps the exact local draft and selection across reading, theme changes and a save echo', async () => {
    const user = userEvent.setup()
    const original = 'const greeting = "你好 🥟";  \r\n\r\n'
    const draft = original + '// draft  '
    const saved: string[] = []
    const onSave = (source: string) => saved.push(source)
    const host = render(
      <CodeBlockView language="ts" onSave={onSave}>
        {original}
      </CodeBlockView>
    )
    expect(host.container.querySelector('.cm-editor')).toBeNull()
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    })
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    const editor = EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
    act(() =>
      editor.dispatch({
        changes: { from: editor.state.doc.length, insert: '// draft  ' },
        selection: { anchor: editor.state.doc.length + 3, head: editor.state.doc.length + 8 }
      })
    )
    await user.click(screen.getByRole('button', { name: 'preview.label' }))
    expect(screen.getByLabelText('Source').textContent).toBe(draft)
    await user.click(screen.getByRole('button', { name: 'code_block.copy.source' }))
    expect(await navigator.clipboard.readText()).toBe(draft)
    appearance.isCodeThemeDark = true
    host.rerender(
      <CodeBlockView language="ts" onSave={onSave}>
        {original}
      </CodeBlockView>
    )
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    })
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    const restored = EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
    expect(restored.state.sliceDoc()).toBe(draft)
    expect(restored.state.sliceDoc(restored.state.selection.main.from, restored.state.selection.main.to)).toBe('draft')
    await user.click(screen.getByRole('button', { name: 'code_block.edit.save.label' }))
    expect(saved).toEqual([draft])
    host.rerender(
      <CodeBlockView language="ts" onSave={onSave}>
        {draft}
      </CodeBlockView>
    )
    expect(EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!).toBe(restored)
    expect(restored.state.sliceDoc()).toBe(draft)
  })

  it('starts a fresh document for an external replacement and uses the current save callback', async () => {
    const user = userEvent.setup()
    const oldSaves: string[] = []
    const newSaves: string[] = []
    const host = render(
      <CodeBlockView language="text" onSave={(source) => oldSaves.push(source)}>
        old
      </CodeBlockView>
    )
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    })
    await waitFor(() => expect(host.container.querySelector('.cm-editor')).not.toBeNull())
    const old = EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
    act(() => old.dispatch({ changes: { from: 3, insert: ' draft' } }))
    host.rerender(
      <CodeBlockView language="text" onSave={(source) => newSaves.push(source)}>
        replacement
      </CodeBlockView>
    )
    await waitFor(() => {
      const current = EditorView.findFromDOM(host.container.querySelector('.cm-editor')!)!
      expect(current.state.sliceDoc()).toBe('replacement')
      expect(current).not.toBe(old)
    })
    await user.click(screen.getByRole('button', { name: 'code_block.edit.save.label' }))
    expect(newSaves).toEqual(['replacement'])
    expect(oldSaves).toEqual([])
  })
})
