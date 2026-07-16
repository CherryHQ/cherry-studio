import type { FilePath } from '@shared/types/file'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlFilePreview from '../HtmlFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
  htmlFrame: vi.fn(),
  getMetadata: vi.fn(),
  readText: vi.fn()
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: (props: { language: string; value: string; wrapped: boolean }) => {
    mocks.codeViewer(props)
    return <div data-testid="code-viewer">{props.value}</div>
  }
}))

vi.mock('@renderer/components/CodeBlockView/HtmlPreviewFrame', async (importOriginal) => {
  // Keep the real named exports (incl. HTML_PREVIEW_RESTRICTED_SANDBOX) so the
  // sandbox assertion checks the actual constant, not a mock stand-in.
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    default: (props: { html: string; title: string; baseUrl?: string; sandbox?: string; csp?: string }) => {
      mocks.htmlFrame(props)
      // The sandbox assertion reads the captured `sandbox` prop (via mocks.htmlFrame),
      // not this DOM attribute, so a static value here keeps the mock lint-clean.
      return (
        <iframe
          data-testid="html-frame"
          data-base-url={props.baseUrl}
          title={props.title}
          srcDoc={props.html}
          sandbox=""
        />
      )
    }
  }
})

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  SegmentedControl: ({
    disabled,
    onValueChange,
    options,
    value
  }: {
    disabled?: boolean
    onValueChange: (value: string) => void
    options: Array<{ label: string; value: string }>
    value: string
  }) => (
    <div>
      {options.map((option) => (
        <button
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          key={option.value}
          onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/workspace/index.html' as FilePath

function renderPreview(overrides: Partial<{ filePath: FilePath; fileName: string; refreshKey: number }> = {}) {
  return render(
    <HtmlFilePreview
      filePath={overrides.filePath ?? filePath}
      fileName={overrides.fileName ?? 'index.html'}
      refreshKey={overrides.refreshKey ?? 0}
    />
  )
}

describe('HtmlFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 42 })
    mocks.readText.mockResolvedValue('<h1>Hello</h1>')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: { getMetadata: mocks.getMetadata },
        fs: { readText: mocks.readText }
      }
    })
  })

  it('reads the file and renders it in a sandboxed frame with a file:// base URL', async () => {
    renderPreview()

    const frame = await screen.findByTestId('html-frame')
    expect(frame).toHaveAttribute('srcdoc', '<h1>Hello</h1>')
    expect(frame.getAttribute('data-base-url')).toMatch(/^file:\/\/.*index\.html$/)
    expect(mocks.getMetadata).toHaveBeenCalledWith({ kind: 'path', path: filePath })
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('previews untrusted local HTML in a fully restricted, script-less sandbox with a strict CSP', async () => {
    renderPreview()
    await screen.findByTestId('html-frame')

    const props = mocks.htmlFrame.mock.calls.at(-1)?.[0]
    // The main window runs with webSecurity:false, so an opaque-origin iframe can still reach
    // parent.api; the only robust guard is running no scripts at all, backed by a strict CSP.
    expect(props?.sandbox).toBe('')
    expect(props?.sandbox).not.toContain('allow-scripts')
    expect(props?.sandbox).not.toContain('allow-same-origin')
    expect(props?.csp).toContain("default-src 'none'")
  })

  it('shows the empty state for empty content', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 0 })
    mocks.readText.mockResolvedValueOnce('')

    renderPreview()

    expect(await screen.findByText('file_preview.html.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('html-frame')).not.toBeInTheDocument()
  })

  it('rejects files over 2 MiB before reading their contents', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 2 * 1024 * 1024 + 1 })

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.html.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.html.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('shows and logs the actual read error for diagnosis', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.html.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('EACCES: permission denied')
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to read HTML preview: ${filePath}`,
      expect.objectContaining({ message: 'EACCES: permission denied' })
    )
  })

  it('switches between rendered preview and wrapped HTML source', async () => {
    renderPreview()
    await screen.findByTestId('html-frame')

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.html.mode.source' }))

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('<h1>Hello</h1>')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'html', value: '<h1>Hello</h1>', wrapped: true })
    )

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.html.mode.preview' }))
    expect(screen.getByTestId('html-frame')).toBeInTheDocument()
  })

  it('reloads when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/about.html' as FilePath
    const view = renderPreview()
    await screen.findByTestId('html-frame')

    view.rerender(<HtmlFilePreview filePath={secondPath} fileName="about.html" refreshKey={0} />)
    await waitFor(() => expect(mocks.getMetadata).toHaveBeenCalledWith({ kind: 'path', path: secondPath }))

    view.rerender(<HtmlFilePreview filePath={secondPath} fileName="about.html" refreshKey={1} />)
    await waitFor(() => expect(mocks.getMetadata).toHaveBeenCalledTimes(3))
  })

  it('ignores a stale read after the path changes', async () => {
    const secondPath = '/tmp/workspace/second.html' as FilePath
    let resolveFirstRead: ((value: string) => void) | undefined
    const firstRead = new Promise<string>((resolve) => {
      resolveFirstRead = resolve
    })
    mocks.readText.mockImplementation((path: FilePath) =>
      path === filePath ? firstRead : Promise.resolve('<p>Second</p>')
    )

    const view = renderPreview()
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(filePath))

    view.rerender(<HtmlFilePreview filePath={secondPath} fileName="second.html" refreshKey={0} />)
    expect(await screen.findByTestId('html-frame')).toHaveAttribute('srcdoc', '<p>Second</p>')

    resolveFirstRead?.('<p>Stale</p>')
    await waitFor(() => expect(screen.getByTestId('html-frame')).toHaveAttribute('srcdoc', '<p>Second</p>'))
  })
})
