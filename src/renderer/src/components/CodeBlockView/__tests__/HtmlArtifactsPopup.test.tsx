import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import HtmlArtifactsPopup, { canCaptureHtmlPreview, HTML_PREVIEW_SANDBOX } from '../HtmlArtifactsPopup'

vi.mock('@renderer/components/CodeEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="code-editor" />
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: Array<string | Record<string, boolean> | undefined>) =>
    values
      .flatMap((value) => {
        if (!value) return []
        if (typeof value === 'string') return [value]
        return Object.entries(value)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key)
      })
      .join(' ')
}))

vi.mock('@renderer/utils/formats', () => ({
  extractHtmlTitle: () => 'Preview',
  getFileNameFromHtmlTitle: () => 'preview'
}))

vi.mock('@renderer/utils/image', () => ({
  captureScrollableIframeAsBlob: vi.fn(),
  captureScrollableIframeAsDataURL: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('antd', async () => {
  const Button = ({ children, icon, ...props }: any) => (
    <button type="button" {...props}>
      {icon}
      {children}
    </button>
  )

  const Modal = ({ open, title, children }: any) =>
    open ? (
      <div>
        {title}
        {children}
      </div>
    ) : null
  const Dropdown = ({ children }: any) => <>{children}</>
  const Tooltip = ({ children }: any) => <>{children}</>
  const Splitter = ({ children }: any) => <div>{children}</div>
  Splitter.Panel = ({ children }: any) => <div>{children}</div>

  return {
    Button,
    Dropdown,
    Modal,
    Splitter,
    Tooltip,
    Typography: {
      Text: ({ children }: any) => <span>{children}</span>
    }
  }
})

describe('HtmlArtifactsPopup', () => {
  it('renders preview iframe with isolated sandbox settings', () => {
    render(
      <HtmlArtifactsPopup
        open
        title="Preview"
        html="<html><body><script>window.top.api</script></body></html>"
        onClose={vi.fn()}
      />
    )

    const frame = screen.getByTitle('common.html_preview')
    expect(frame).toHaveAttribute('sandbox', HTML_PREVIEW_SANDBOX)
    expect(HTML_PREVIEW_SANDBOX).not.toContain('allow-same-origin')
    expect(HTML_PREVIEW_SANDBOX).not.toContain('allow-forms')
  })

  it('disables capture when preview is isolated from the host origin', () => {
    render(<HtmlArtifactsPopup open title="Preview" html="<html></html>" onClose={vi.fn()} />)

    const captureButton = screen.getByTestId('html-artifacts-capture')
    expect(canCaptureHtmlPreview).toBe(false)
    expect(captureButton).toBeDisabled()
  })
})
