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

  it('dismisses the capture menu after selecting a destination', () => {
    render(<HtmlArtifactsPopup open editable={false} title="HTML Artifacts" html="<h1>Hello</h1>" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.capture.label' }))
    fireEvent.click(screen.getByRole('button', { name: /html_artifacts\.capture\.to_file/ }))

    expect(screen.queryByRole('button', { name: /html_artifacts\.capture\.to_file/ })).not.toBeInTheDocument()
  })

  it('renders a script-less frame and keeps capture available for an inert fragment', () => {
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html="<div><h2>Hello</h2></div>"
        onClose={vi.fn()}
      />
    )

    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'html_artifacts.capture.label' })).toBeInTheDocument()
  })

  it('still honors an explicit canCapturePreview={false} on the default preview path', () => {
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html="<div><h2>Hello</h2></div>"
        canCapturePreview={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTitle('common.html_preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'html_artifacts.capture.label' })).not.toBeInTheDocument()
  })

  it('opens active fragments static by default and only runs them via the explicit action', async () => {
    const user = userEvent.setup()
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html={'<div><canvas id="c"></canvas><script>parent.api.fs.readText("/etc/hosts")</script></div>'}
        onClose={vi.fn()}
      />
    )

    // Security default: script-less frame, no webview, capture still available.
    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' }))

    const webview = screen.getByTestId('interactive-html-webview')
    expect(webview).toHaveAttribute('partition', 'html-artifact-preview')
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'html_artifacts.capture.label' })).not.toBeInTheDocument()
  })

  it('revokes authorization synchronously when the html changes mid-popup', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html={'<!doctype html><html><body><script>first()</script></body></html>'}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' }))
    expect(screen.getByTestId('interactive-html-webview')).toBeInTheDocument()

    // Streamed bytes arrive: the new active html must NOT inherit the run action —
    // the same render that sees the new html must be back on the static tier.
    rerender(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html={'<!doctype html><html><body><script>second()</script></body></html>'}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTitle('common.html_preview')).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' })).toBeInTheDocument()
  })

  it('keeps script-bearing documents static until the explicit action, then isolates them', async () => {
    const user = userEvent.setup()
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html={'<!doctype html><html><body><script>parent.api.fs.readText("/etc/hosts")</script></body></html>'}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTitle('common.html_preview')).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' }))

    expect(screen.getByTestId('interactive-html-webview')).toHaveAttribute('partition', 'html-artifact-preview')
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })
})
