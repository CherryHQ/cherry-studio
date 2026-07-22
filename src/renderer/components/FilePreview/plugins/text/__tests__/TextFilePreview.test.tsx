import type { FilePath } from '@shared/types/file'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TextFilePreview from '../TextFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
  getMetadata: vi.fn(),
  isTextFile: vi.fn(),
  readText: vi.fn()
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: (props: { language: string; value: string; wrapped: boolean }) => {
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

const filePath = '/tmp/workspace/example.ts' as FilePath

function renderPreview(refreshKey = 0) {
  return render(<TextFilePreview filePath={filePath} fileName="example.ts" refreshKey={refreshKey} />)
}

describe('TextFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 24 })
    mocks.readText.mockResolvedValue('const answer = 42')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: { getMetadata: mocks.getMetadata, isTextFile: mocks.isTextFile },
        fs: { readText: mocks.readText }
      }
    })
  })

  it('renders highlighted source without line wrapping', async () => {
    renderPreview()

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('const answer = 42')
    expect(mocks.getMetadata).toHaveBeenCalledWith({ kind: 'path', path: filePath })
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
    expect(mocks.isTextFile).not.toHaveBeenCalled()
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'TypeScript', value: 'const answer = 42', wrapped: false })
    )
  })

  it('shows a zero-byte empty state without reading the file', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 0 })

    renderPreview()

    await screen.findByText('file_preview.text.empty.title')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.text.empty.title')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('rejects files over 2 MiB before reading their contents', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 2 * 1024 * 1024 + 1 })

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.text.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.text.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('reads files at exactly the 2 MiB limit', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 2 * 1024 * 1024 })

    renderPreview()

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('renders non-empty whitespace as source content', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 3 })
    mocks.readText.mockResolvedValueOnce(' \n')

    renderPreview()

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ value: ' \n' }))
    expect(screen.queryByText('file_preview.text.empty.title')).not.toBeInTheDocument()
  })

  it('shows and logs the actual read error for diagnosis', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.text.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('EACCES: permission denied')
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to read text preview: ${filePath}`,
      expect.objectContaining({ message: 'EACCES: permission denied' })
    )
  })

  it('keeps the loading state while file metadata is pending', async () => {
    let resolveMetadata: ((value: { kind: 'file'; size: number }) => void) | undefined
    mocks.getMetadata.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMetadata = resolve
      })
    )

    renderPreview()

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    resolveMetadata?.({ kind: 'file', size: 24 })
    await waitFor(() => expect(screen.getByTestId('code-viewer')).toBeInTheDocument())
  })

  it('reloads when the refresh key changes', async () => {
    const view = renderPreview()
    await screen.findByTestId('code-viewer')

    view.rerender(<TextFilePreview filePath={filePath} fileName="example.ts" refreshKey={1} />)

    await waitFor(() => expect(mocks.getMetadata).toHaveBeenCalledTimes(2))
    expect(mocks.readText).toHaveBeenCalledTimes(2)
  })
})
