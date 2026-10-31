import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewType } from '../../../types'
import HtmlFilePreview from '../HtmlFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
  htmlFrame: vi.fn(),
  readText: vi.fn(),
  webviewBrowser: vi.fn()
}))

vi.mock('@renderer/components/WebviewBrowser', () => ({
  WebviewBrowser: (props: {
    initialUrl: string
    reloadKey?: number
    securityProfile: string
    target: { id: string; label: string }
  }) => {
    mocks.webviewBrowser(props)
    return (
      <div
        data-testid="webview-browser"
        data-url={props.initialUrl}
        data-security-profile={props.securityProfile}
        data-target-id={props.target.id}
        data-target-label={props.target.label}
      />
    )
  }
}))

vi.mock('@renderer/components/FileEditor', () => ({
  default: (props: { fileName: string; value: string; wrapLines: boolean; readOnly: boolean }) => {
    mocks.codeViewer(props)
    return <textarea aria-label="HTML source" readOnly={props.readOnly} defaultValue={props.value} />
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
  Button: (props: ComponentPropsWithoutRef<'button'>) => <button type="button" {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/workspace/index.html' as AbsoluteFilePath

function renderPreview(
  overrides: Partial<{
    filePath: AbsoluteFilePath
    fileName: string
    refreshKey: number
    size: number
    type: FilePreviewType
  }> = {}
) {
  return render(
    <HtmlFilePreview
      filePath={overrides.filePath ?? filePath}
      fileName={overrides.fileName ?? 'index.html'}
      metadata={{ size: overrides.size ?? 42, modifiedAt: 1 }}
      refreshKey={overrides.refreshKey ?? 0}
      type={overrides.type ?? 'file'}
    />
  )
}

describe('HtmlFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readText.mockResolvedValue('<h1>Hello</h1>')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: { readText: mocks.readText }
      }
    })
  })

  it('reads the file and renders it in a sandboxed frame with a file:// base URL', async () => {
    renderPreview()

    const frame = await screen.findByTestId('html-frame')
    expect(frame).toHaveAttribute('srcdoc', '<h1>Hello</h1>')
    expect(frame.getAttribute('data-base-url')).toMatch(/^file:\/\/.*index\.html$/)
    expect(frame.parentElement).toHaveClass('h-full', 'bg-white')
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
    mocks.readText.mockResolvedValueOnce('')

    renderPreview({ size: 0 })

    expect(await screen.findByText('file_preview.html.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('html-frame')).not.toBeInTheDocument()
  })

  it('rejects files over 8 MiB before reading their contents', async () => {
    renderPreview({ size: 8 * 1024 * 1024 + 1 })

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.html.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.html.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('renders files at exactly the 8 MiB limit', async () => {
    mocks.readText.mockResolvedValueOnce('<h1>Boundary content</h1>')
    renderPreview({ size: 8 * 1024 * 1024 })

    expect(await screen.findByTestId('html-frame')).toHaveAttribute('srcdoc', '<h1>Boundary content</h1>')
  })

  it('logs the actual read error but shows only a localized description', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.html.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    // The raw (English) error message must not leak into the UI — it is for logs only.
    expect(screen.queryByText('EACCES: permission denied')).not.toBeInTheDocument()
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to read HTML preview: ${filePath}`,
      expect.objectContaining({ message: 'EACCES: permission denied' })
    )
  })

  it('switches between rendered preview and wrapped HTML source', async () => {
    renderPreview()
    await screen.findByTestId('html-frame')

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.html.mode.source' }))

    expect(await screen.findByRole('textbox', { name: 'HTML source' })).toHaveValue('<h1>Hello</h1>')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileName: 'index.html', value: '<h1>Hello</h1>', wrapLines: true, readOnly: true })
    )

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.html.mode.preview' }))
    expect(screen.getByTestId('html-frame')).toBeInTheDocument()
  })

  it('opens artifact HTML in the shared WebView browser and keeps ordinary file HTML in the restricted iframe', async () => {
    renderPreview({ type: 'artifact' })

    const browser = await screen.findByTestId('webview-browser')
    expect(browser.getAttribute('data-url')).toMatch(/^file:\/\/.*index\.html$/)
    expect(browser).toHaveAttribute('data-target-label', 'index.html')
    expect(browser).toHaveAttribute('data-security-profile', 'agent-html-artifact')
    expect(mocks.readText).not.toHaveBeenCalled()
    expect(screen.queryByTestId('html-frame')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file_preview.html.mode.preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file_preview.html.mode.source' })).not.toBeInTheDocument()
  })

  it('reloads when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/about.html' as AbsoluteFilePath
    const view = renderPreview()
    await screen.findByTestId('html-frame')

    view.rerender(
      <HtmlFilePreview
        filePath={secondPath}
        fileName="about.html"
        metadata={{ size: 42, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(secondPath))

    view.rerender(
      <HtmlFilePreview
        filePath={secondPath}
        fileName="about.html"
        metadata={{ size: 42, modifiedAt: 1 }}
        refreshKey={1}
      />
    )
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(3))
  })

  it('reloads the iframe after an unchanged HTML read completes, retaining source mode on later refreshes', async () => {
    const user = userEvent.setup()
    const html = '<link rel="stylesheet" href="style.css"><h1>Hello</h1>'
    mocks.readText.mockResolvedValue(html)
    const view = renderPreview()
    const original = await screen.findByTestId('html-frame')
    let finishRead!: (content: string) => void
    mocks.readText.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishRead = resolve
      })
    )
    const props = { filePath, fileName: 'index.html', metadata: { size: 42, modifiedAt: 1 } }
    view.rerender(<HtmlFilePreview {...props} refreshKey={1} />)
    expect(screen.getByTestId('html-frame')).toBe(original)
    await act(async () => {
      finishRead(html)
    })
    expect(screen.getByTestId('html-frame')).not.toBe(original)
    expect(screen.getByTestId('html-frame')).toHaveAttribute('srcdoc', html)

    await user.click(screen.getByRole('button', { name: 'file_preview.html.mode.source' }))
    await screen.findByRole('textbox', { name: 'HTML source' })
    view.rerender(<HtmlFilePreview {...props} refreshKey={2} />)
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(3))
    // Still in source mode: the toggle now offers the way back to the preview.
    expect(screen.getByRole('button', { name: 'file_preview.html.mode.preview' })).toBeInTheDocument()
    expect(screen.queryByTestId('html-frame')).not.toBeInTheDocument()
  })

  it('ignores a stale read after the path changes', async () => {
    const secondPath = '/tmp/workspace/second.html' as AbsoluteFilePath
    let resolveFirstRead: ((value: string) => void) | undefined
    const firstRead = new Promise<string>((resolve) => {
      resolveFirstRead = resolve
    })
    mocks.readText.mockImplementation((path: AbsoluteFilePath) =>
      path === filePath ? firstRead : Promise.resolve('<p>Second</p>')
    )

    const view = renderPreview()
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(filePath))

    view.rerender(
      <HtmlFilePreview
        filePath={secondPath}
        fileName="second.html"
        metadata={{ size: 42, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    expect(await screen.findByTestId('html-frame')).toHaveAttribute('srcdoc', '<p>Second</p>')

    resolveFirstRead?.('<p>Stale</p>')
    await waitFor(() => expect(screen.getByTestId('html-frame')).toHaveAttribute('srcdoc', '<p>Second</p>'))
  })

  it('ignores an obsolete read failure while replacement metadata is pending', async () => {
    const obsoleteRead = Promise.withResolvers<string>()
    const metadata = {
      kind: 'file' as const,
      type: 'text' as const,
      size: 42,
      modifiedAt: 1,
      createdAt: 1,
      mime: 'text/html'
    }
    const latestMetadata = Promise.withResolvers<typeof metadata>()
    const currentMetadata = () => Promise.resolve(metadata)
    const replacementMetadata = () => latestMetadata.promise
    const props = { filePath, fileName: 'index.html', metadata }
    const view = render(<HtmlFilePreview {...props} refreshKey={0} metadataRequest={currentMetadata} />)
    const frame = await screen.findByTestId('html-frame')
    mocks.readText.mockReturnValueOnce(obsoleteRead.promise).mockResolvedValueOnce('<h1>Updated</h1>')

    view.rerender(<HtmlFilePreview {...props} refreshKey={1} metadataRequest={currentMetadata} />)
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(2))
    view.rerender(<HtmlFilePreview {...props} refreshKey={1} metadataRequest={replacementMetadata} />)
    await act(async () => obsoleteRead.reject(new Error('Obsolete read failed')))
    expect(screen.getByTestId('html-frame')).toBe(frame)
    expect(frame).toHaveAttribute('srcdoc', '<h1>Hello</h1>')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.readText).toHaveBeenCalledTimes(2)

    const refreshedMetadata = { ...metadata, size: 64, modifiedAt: 3 }
    await act(async () => latestMetadata.resolve(refreshedMetadata))
    await waitFor(() => expect(screen.getByTestId('html-frame')).toHaveAttribute('srcdoc', '<h1>Updated</h1>'))
    view.rerender(
      <HtmlFilePreview {...props} metadata={refreshedMetadata} refreshKey={1} metadataRequest={replacementMetadata} />
    )
    expect(mocks.readText).toHaveBeenCalledTimes(3)
  })
})
