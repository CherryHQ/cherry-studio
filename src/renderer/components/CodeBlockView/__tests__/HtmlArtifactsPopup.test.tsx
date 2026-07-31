import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import HtmlArtifactsPopup from '../HtmlArtifactsPopup'

const mocks = vi.hoisted(() => ({
  CodeEditor: vi.fn(({ value }: { value: string }) => (
    <div role="textbox" aria-label="HTML editor">
      {value}
    </div>
  )),
  CodeViewer: vi.fn(({ value }: { value: string }) => <pre aria-label="HTML source">{value}</pre>),
  t: (key: string) => key
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  CodeEditor: mocks.CodeEditor
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

describe('HtmlArtifactsPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.message.font_size', 14)
  })

  it('defaults to preview and switches to read-only source', async () => {
    const user = userEvent.setup()
    render(<HtmlArtifactsPopup open editable={false} title="HTML Artifacts" html="<h1>Hello</h1>" onClose={vi.fn()} />)

    expect(screen.getByTitle('common.html_preview')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'html_artifacts.preview' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'html_artifacts.code' }))

    expect(screen.getByLabelText('HTML source')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByRole('textbox', { name: 'HTML editor' })).not.toBeInTheDocument()
  })

  it('shows the editor in code mode when editing is allowed', async () => {
    const user = userEvent.setup()
    render(
      <HtmlArtifactsPopup
        open
        editable
        title="HTML Artifacts"
        html="<h1>Hello</h1>"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    await user.click(screen.getByRole('radio', { name: 'html_artifacts.code' }))

    expect(screen.getByRole('textbox', { name: 'HTML editor' })).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByLabelText('HTML source')).not.toBeInTheDocument()
  })

  it('renders a caller-provided preview in the popup shell', () => {
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html="<h1>Hello</h1>"
        canCapturePreview={false}
        renderPreview={() => <div>Custom preview</div>}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog', { name: 'HTML Artifacts' })).toBeInTheDocument()
    expect(screen.getByText('Custom preview')).toBeInTheDocument()
  })

  it('keeps the popup open when the overlay is clicked', () => {
    const onClose = vi.fn()
    render(<HtmlArtifactsPopup open editable={false} title="HTML Artifacts" html="<h1>Hello</h1>" onClose={onClose} />)
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')

    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay!)
    expect(onClose).not.toHaveBeenCalled()
  })
})
