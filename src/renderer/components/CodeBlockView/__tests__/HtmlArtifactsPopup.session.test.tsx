import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@uiw/react-codemirror'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCodeBlockLanguage } from '@cherrystudio/ui/code-block'

import HtmlArtifactsPopup from '../HtmlArtifactsPopup'

vi.unmock('@cherrystudio/ui')
const { appearance, t } = vi.hoisted(() => ({ appearance: { isCodeThemeDark: false }, t: (key: string) => key }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCodeStyle: () => appearance }))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre aria-label="HTML source">{value}</pre>
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t })
}))

const rangeDescriptors = Object.getOwnPropertyDescriptors(Range.prototype)

beforeEach(async () => {
  await loadCodeBlockLanguage('html')
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
  appearance.isCodeThemeDark = false
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('chat.message.font_size', 14)
})

afterEach(() => {
  for (const key of ['getClientRects', 'getBoundingClientRect']) {
    if (rangeDescriptors[key]) Object.defineProperty(Range.prototype, key, rangeDescriptors[key])
    else Reflect.deleteProperty(Range.prototype, key)
  }
})

const original = '<h1>Hello 中文 🥟</h1>  \n\n'
const addition = '<!-- draft 中文 🥟 -->  \n'

async function editor() {
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
  return EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
}

describe('HTML artifact popup session', () => {
  it('retains draft, selection and undo across layouts and accepts a save echo without resetting history', async () => {
    const user = userEvent.setup()
    function Popup() {
      const [html, setHtml] = useState(original)
      return <HtmlArtifactsPopup open title="Artifact" html={html} onSave={setHtml} onClose={() => {}} />
    }
    render(<Popup />)
    await act(async () => {
      await user.click(screen.getByRole('radio', { name: 'html_artifacts.code' }))
    })
    const first = await editor()
    act(() =>
      first.dispatch({
        changes: { from: first.state.doc.length, insert: addition },
        selection: { anchor: original.length + 5, head: original.length + 10 }
      })
    )
    await user.click(screen.getByRole('radio', { name: 'html_artifacts.split' }))
    const split = await editor()
    expect(split.state.sliceDoc()).toBe(original + addition)
    expect(split.state.sliceDoc(split.state.selection.main.from, split.state.selection.main.to)).toBe('draft')
    await user.click(screen.getByRole('radio', { name: 'html_artifacts.preview' }))
    expect(screen.getByTitle('common.html_preview').getAttribute('srcdoc')).not.toContain(addition)
    await user.click(screen.getByRole('radio', { name: 'html_artifacts.code' }))
    const restored = await editor()
    expect(restored.state.sliceDoc()).toBe(original + addition)
    expect(restored.state.sliceDoc(restored.state.selection.main.from, restored.state.selection.main.to)).toBe('draft')
    act(() => restored.focus())
    await user.keyboard('{Control>}z{/Control}')
    expect(restored.state.sliceDoc()).toBe(original)
    await user.keyboard('{Control>}y{/Control}')
    expect(restored.state.sliceDoc()).toBe(original + addition)
    await user.click(screen.getByRole('button', { name: 'code_block.edit.save.label' }))
    await user.click(screen.getByRole('radio', { name: 'html_artifacts.preview' }))
    expect(screen.getByTitle('common.html_preview').getAttribute('srcdoc')).toContain(addition)
    await user.click(screen.getByRole('radio', { name: 'html_artifacts.split' }))
    const saved = await editor()
    act(() => saved.focus())
    await user.keyboard('{Control>}z{/Control}')
    expect(saved.state.sliceDoc()).toBe(original)
  })

  it('discards an old draft for an external replacement or a reopened popup and installs the current save callback', async () => {
    const user = userEvent.setup()
    const saves: string[] = []
    const host = render(
      <HtmlArtifactsPopup open title="Artifact" html={original} onSave={() => saves.push('old')} onClose={() => {}} />
    )
    await act(async () => {
      await user.click(screen.getByRole('radio', { name: 'html_artifacts.code' }))
    })
    const first = await editor()
    act(() => first.dispatch({ changes: { from: first.state.doc.length, insert: addition } }))
    const replacement = '<h2>External</h2>\n'
    const props = {
      title: 'Artifact',
      html: replacement,
      onSave: (value: string) => saves.push(value),
      onClose: () => {}
    }
    host.rerender(<HtmlArtifactsPopup {...props} open />)
    const fresh = await editor()
    expect(fresh.state.sliceDoc()).toBe(replacement)
    act(() => fresh.focus())
    await user.keyboard('{Control>}z{/Control}')
    expect(fresh.state.sliceDoc()).toBe(replacement)
    await user.click(screen.getByRole('button', { name: 'code_block.edit.save.label' }))
    expect(saves).toEqual([replacement])
    act(() => fresh.dispatch({ changes: { from: fresh.state.doc.length, insert: addition } }))
    host.rerender(<HtmlArtifactsPopup {...props} open={false} />)
    host.rerender(<HtmlArtifactsPopup {...props} open />)
    expect((await editor()).state.sliceDoc()).toBe(replacement)
  })
})
