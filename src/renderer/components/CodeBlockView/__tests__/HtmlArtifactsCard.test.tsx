import { toast } from '@renderer/services/toast'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsCard from '../HtmlArtifactsCard'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  HtmlArtifactsPopup: vi.fn(({ open }) => (open ? <div data-testid="html-artifacts-popup" /> : null)),
  loadHtmlArtifactsPopup: vi.fn(),
  loggerError: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
  write: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError,
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: vi.fn((error, prefix) => `${prefix}: ${(error as Error).message}`)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock('../HtmlArtifactsPopup', () => {
  mocks.loadHtmlArtifactsPopup()

  return {
    default: mocks.HtmlArtifactsPopup
  }
})

describe('HtmlArtifactsCard', () => {
  const html = '<!doctype html><html><head><title>Sample Page</title></head><body>Hello</body></html>'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/Sample-Page.html')
    mocks.write.mockResolvedValue(undefined)

    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        file: {
          createTempFile: mocks.createTempFile,
          openPath: mocks.openPath,
          save: mocks.save,
          write: mocks.write
        }
      }
    })
  })

  it('opens the generated HTML file through the file API', async () => {
    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html'))
    expect(mocks.createTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mocks.write).toHaveBeenCalledWith('/tmp/artifacts-preview.html', html)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows an error when opening the generated HTML file fails', async () => {
    mocks.openPath.mockRejectedValueOnce(new Error('open failed'))

    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('chat.artifacts.preview.openExternal.error.content: open failed')
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open HTML artifact externally', expect.any(Error))
  })

  it('downloads the HTML artifact', async () => {
    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('Sample-Page.html', html))
    expect(toast.success).toHaveBeenCalledWith('message.download.success')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows an error when downloading the HTML artifact fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('save failed'))

    render(<HtmlArtifactsCard html={html} />)

    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('message.download.failed: save failed'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('loads and mounts the popup only after preview opens', async () => {
    const onSave = vi.fn()

    render(<HtmlArtifactsCard html={html} onSave={onSave} editable={false} />)

    expect(mocks.loadHtmlArtifactsPopup).not.toHaveBeenCalled()
    expect(screen.queryByTestId('html-artifacts-popup')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.preview' }))

    expect(await screen.findByTestId('html-artifacts-popup')).toBeInTheDocument()
    expect(mocks.loadHtmlArtifactsPopup).toHaveBeenCalledTimes(1)
    expect(mocks.HtmlArtifactsPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        editable: false,
        html,
        onSave,
        open: true,
        title: 'Sample Page'
      }),
      undefined
    )
  })

  it('escapes the surrounding Markdown code block styling', () => {
    const { container } = render(<HtmlArtifactsCard html={html} />)

    expect(container.firstElementChild).toHaveClass('special-preview', 'font-[var(--font-family-body)]')
  })

  it('uses the localized HTML preview name when the document has no title', () => {
    render(<HtmlArtifactsCard html="<main>Page</main>" />)

    expect(screen.getByTitle('common.html_preview')).toBeInTheDocument()
  })
})
