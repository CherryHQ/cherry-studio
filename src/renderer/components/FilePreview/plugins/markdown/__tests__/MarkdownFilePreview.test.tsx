import type { FilePath } from '@shared/types/file'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownFilePreview from '../MarkdownFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
  getMetadata: vi.fn(),
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
  Markdown: ({ children }: { children: ReactNode }) => <article data-testid="markdown-preview">{children}</article>,
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>,
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
  withFullMarkdown: () => ({})
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/workspace/README.md' as FilePath

function renderPreview(overrides: Partial<{ filePath: FilePath; fileName: string; refreshKey: number }> = {}) {
  return render(
    <MarkdownFilePreview
      filePath={overrides.filePath ?? filePath}
      fileName={overrides.fileName ?? 'README.md'}
      refreshKey={overrides.refreshKey ?? 0}
    />
  )
}

describe('MarkdownFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 15 })
    mocks.readText.mockResolvedValue('# File preview')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: { getMetadata: mocks.getMetadata },
        fs: { readText: mocks.readText }
      }
    })
  })

  it('reads and renders Markdown through the existing file IPC', async () => {
    renderPreview()

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('# File preview')
    expect(mocks.getMetadata).toHaveBeenCalledWith({ kind: 'path', path: filePath })
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('shows the empty state for empty content', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 0 })
    mocks.readText.mockResolvedValueOnce('')

    renderPreview()

    expect(await screen.findByText('file_preview.markdown.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
  })

  it('rejects files over 2 MiB before reading their contents', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 2 * 1024 * 1024 + 1 })

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.markdown.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.markdown.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('shows and logs the actual read error for diagnosis', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.markdown.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('EACCES: permission denied')
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to read Markdown preview: ${filePath}`,
      expect.objectContaining({ message: 'EACCES: permission denied' })
    )
  })

  it('switches between rendered preview and wrapped source', async () => {
    renderPreview()
    await screen.findByTestId('markdown-preview')

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.markdown.mode.source' }))

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('# File preview')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'markdown', value: '# File preview', wrapped: true })
    )

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.markdown.mode.preview' }))
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
  })

  it('reloads when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/CHANGELOG.md' as FilePath
    const view = renderPreview()
    await screen.findByTestId('markdown-preview')

    view.rerender(<MarkdownFilePreview filePath={secondPath} fileName="CHANGELOG.md" refreshKey={0} />)
    await waitFor(() => expect(mocks.getMetadata).toHaveBeenCalledWith({ kind: 'path', path: secondPath }))

    view.rerender(<MarkdownFilePreview filePath={secondPath} fileName="CHANGELOG.md" refreshKey={1} />)
    await waitFor(() => expect(mocks.getMetadata).toHaveBeenCalledTimes(3))
  })

  it('ignores a stale read after the path changes', async () => {
    const secondPath = '/tmp/workspace/SECOND.md' as FilePath
    let resolveFirstRead: ((value: string) => void) | undefined
    const firstRead = new Promise<string>((resolve) => {
      resolveFirstRead = resolve
    })
    mocks.readText.mockImplementation((path: FilePath) =>
      path === filePath ? firstRead : Promise.resolve('# Second file')
    )

    const view = renderPreview()
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(filePath))

    view.rerender(<MarkdownFilePreview filePath={secondPath} fileName="SECOND.md" refreshKey={0} />)
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('# Second file')

    resolveFirstRead?.('# Stale file')
    await waitFor(() => expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Second file'))
  })
})
