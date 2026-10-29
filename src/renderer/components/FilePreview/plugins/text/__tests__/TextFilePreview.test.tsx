import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import TextFilePreview from '../TextFilePreview'

const mocks = vi.hoisted(() => ({
  readText: vi.fn()
}))

vi.mock('@renderer/components/FileEditor', () => ({
  default: (props: { value: string }) => <div data-testid="code-viewer">{props.value}</div>
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

  it('renders loaded source text', async () => {
    renderPreview()

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('const answer = 42')
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('shows a zero-byte empty state without reading the file', async () => {
    renderPreview(0, 0)

    await screen.findByText('file_preview.text.empty.title')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.text.empty.title')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('rejects files over 8 MiB before reading their contents', async () => {
    renderPreview(0, 8 * 1024 * 1024 + 1)

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.text.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.text.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('reads files at exactly the 8 MiB limit', async () => {
    renderPreview(0, 8 * 1024 * 1024)

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('const answer = 42')
  })

  it('renders non-empty whitespace as source content', async () => {
    mocks.readText.mockResolvedValueOnce(' \n')

    renderPreview(0, 3)

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('code-viewer').textContent).toBe(' \n')
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

  it('ignores an obsolete read failure while replacement metadata is pending', async () => {
    const obsoleteRead = Promise.withResolvers<string>()
    const metadata = {
      kind: 'file' as const,
      type: 'text' as const,
      size: 24,
      modifiedAt: 1,
      createdAt: 1,
      mime: 'text/plain'
    }
    const latestMetadata = Promise.withResolvers<typeof metadata>()
    const currentMetadata = () => Promise.resolve(metadata)
    const replacementMetadata = () => latestMetadata.promise
    const props = { filePath, fileName: 'example.ts', metadata }
    const view = render(<TextFilePreview {...props} refreshKey={0} metadataRequest={currentMetadata} />)
    const viewer = await screen.findByTestId('code-viewer')
    mocks.readText.mockReturnValueOnce(obsoleteRead.promise).mockResolvedValueOnce('const answer = 43')

    view.rerender(<TextFilePreview {...props} refreshKey={1} metadataRequest={currentMetadata} />)
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(2))
    view.rerender(<TextFilePreview {...props} refreshKey={1} metadataRequest={replacementMetadata} />)
    await act(async () => obsoleteRead.reject(new Error('Obsolete read failed')))
    expect(screen.getByTestId('code-viewer')).toBe(viewer)
    expect(viewer).toHaveTextContent('const answer = 42')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.readText).toHaveBeenCalledTimes(2)

    const refreshedMetadata = { ...metadata, size: 32, modifiedAt: 3 }
    await act(async () => latestMetadata.resolve(refreshedMetadata))
    await waitFor(() => expect(screen.getByTestId('code-viewer')).toHaveTextContent('const answer = 43'))
    view.rerender(
      <TextFilePreview {...props} metadata={refreshedMetadata} refreshKey={1} metadataRequest={replacementMetadata} />
    )
    expect(mocks.readText).toHaveBeenCalledTimes(3)
  })
})
