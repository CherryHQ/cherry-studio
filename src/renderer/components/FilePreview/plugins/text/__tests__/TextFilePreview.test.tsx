import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import TextFilePreview from '../TextFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
  readText: vi.fn()
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: (props: { language: string; options?: { highlight?: boolean }; value: string; wrapped: boolean }) => {
    mocks.codeViewer(props)
    return <div data-testid="code-viewer">{props.value}</div>
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/workspace/example.ts' as AbsoluteFilePath

function renderPreview(refreshKey = 0, size = 24) {
  return render(
    <TextFilePreview
      filePath={filePath}
      fileName="example.ts"
      metadata={{ size, modifiedAt: 1 }}
      refreshKey={refreshKey}
    />
  )
}

describe('TextFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readText.mockResolvedValue('const answer = 42')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: { readText: mocks.readText }
      }
    })
  })

  it('renders highlighted source with line wrapping', async () => {
    renderPreview()

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('const answer = 42')
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      // CodeViewer defaults to wrapped=true; TextFilePreview must not override it with false.
      expect.not.objectContaining({ wrapped: false })
    )
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ options: { highlight: true } }))
  })

  it('renders source in a viewer with a bounded scroll viewport', async () => {
    renderPreview()

    await screen.findByTestId('code-viewer')
    // The viewer's virtualizer windows rows against its own scroller, so it must own a bounded
    // viewport — an unbounded wrapper hands it the whole document and materializes every row.
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: false, height: '100%' }))
  })

  // Shiki tokenizes in a worker and only up to the last visible row, so a large document is free
  // up front — only lines too long to window can still block the layout engine.
  it('keeps syntax highlighting for a large file whose lines are ordinary', async () => {
    renderPreview(0, 2 * 1024 * 1024 - 1)

    await screen.findByTestId('code-viewer')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ options: { highlight: true } }))
  })

  it('drops syntax highlighting for a file dominated by very long lines', async () => {
    mocks.readText.mockResolvedValueOnce('a'.repeat(60_000))

    renderPreview(0, 60_000)

    await screen.findByTestId('code-viewer')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ options: { highlight: false } }))
  })

  it('shows a zero-byte empty state without reading the file', async () => {
    renderPreview(0, 0)

    await screen.findByText('file_preview.text.empty.title')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.text.empty.title')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('rejects files over 2 MiB before reading their contents', async () => {
    renderPreview(0, 2 * 1024 * 1024 + 1)

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.text.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.text.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('reads files at exactly the 2 MiB limit', async () => {
    renderPreview(0, 2 * 1024 * 1024)

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('renders non-empty whitespace as source content', async () => {
    mocks.readText.mockResolvedValueOnce(' \n')

    renderPreview(0, 3)

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ value: ' \n' }))
    expect(screen.queryByText('file_preview.text.empty.title')).not.toBeInTheDocument()
  })

  it('logs the actual read error but shows only a localized description', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.text.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    // The raw (English) error message must not leak into the UI — it is for logs only.
    expect(screen.queryByText('EACCES: permission denied')).not.toBeInTheDocument()
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to read text preview: ${filePath}`,
      expect.objectContaining({ message: 'EACCES: permission denied' })
    )
  })

  it('keeps the loading state while file content is pending', async () => {
    let resolveContent: ((value: string) => void) | undefined
    mocks.readText.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveContent = resolve
      })
    )

    renderPreview()

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    resolveContent?.('const answer = 42')
    await waitFor(() => expect(screen.getByTestId('code-viewer')).toBeInTheDocument())
  })

  it('reloads when the refresh key changes', async () => {
    const view = renderPreview()
    await screen.findByTestId('code-viewer')

    view.rerender(
      <TextFilePreview
        filePath={filePath}
        fileName="example.ts"
        metadata={{ size: 24, modifiedAt: 1 }}
        refreshKey={1}
      />
    )

    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(2))
  })
})
