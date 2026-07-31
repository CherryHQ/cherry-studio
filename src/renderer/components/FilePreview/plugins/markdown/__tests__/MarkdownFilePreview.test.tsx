import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewType } from '../../../types'
import MarkdownFilePreview from '../MarkdownFilePreview'

const mocks = vi.hoisted(() => ({
  codeViewer: vi.fn(),
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

const filePath = '/tmp/workspace/README.md' as AbsoluteFilePath

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
    <MarkdownFilePreview
      filePath={overrides.filePath ?? filePath}
      fileName={overrides.fileName ?? 'README.md'}
      metadata={{ size: overrides.size ?? 15 }}
      refreshKey={overrides.refreshKey ?? 0}
      type={overrides.type ?? 'file'}
    />
  )
}

describe('MarkdownFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readText.mockResolvedValue('# File preview')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: { readText: mocks.readText }
      }
    })
  })

  it('reads and renders Markdown through the existing file IPC', async () => {
    renderPreview()

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('# File preview')
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('shows the empty state for empty content', async () => {
    mocks.readText.mockResolvedValueOnce('')

    renderPreview({ size: 0 })

    expect(await screen.findByText('file_preview.markdown.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
  })

  it('rejects files over 2 MiB before reading their contents', async () => {
    renderPreview({ size: 2 * 1024 * 1024 + 1 })

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.markdown.too_large.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.markdown.too_large.description')
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('logs the actual read error but shows only a localized description', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.readText.mockRejectedValueOnce(new Error('EACCES: permission denied'))

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.markdown.read_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    // The raw (English) error message must not leak into the UI — it is for logs only.
    expect(screen.queryByText('EACCES: permission denied')).not.toBeInTheDocument()
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

  it('hides the source switch for artifact previews whose host owns editing', async () => {
    renderPreview({ type: 'artifact' })

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('# File preview')
    expect(screen.queryByRole('button', { name: 'file_preview.markdown.mode.preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file_preview.markdown.mode.source' })).not.toBeInTheDocument()
  })

  it('reloads when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/CHANGELOG.md' as AbsoluteFilePath
    const view = renderPreview()
    await screen.findByTestId('markdown-preview')

    view.rerender(
      <MarkdownFilePreview filePath={secondPath} fileName="CHANGELOG.md" metadata={{ size: 15 }} refreshKey={0} />
    )
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(secondPath))

    view.rerender(
      <MarkdownFilePreview filePath={secondPath} fileName="CHANGELOG.md" metadata={{ size: 15 }} refreshKey={1} />
    )
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(3))
  })

  it('ignores a stale read after the path changes', async () => {
    const secondPath = '/tmp/workspace/SECOND.md' as AbsoluteFilePath
    let resolveFirstRead: ((value: string) => void) | undefined
    const firstRead = new Promise<string>((resolve) => {
      resolveFirstRead = resolve
    })
    mocks.readText.mockImplementation((path: AbsoluteFilePath) =>
      path === filePath ? firstRead : Promise.resolve('# Second file')
    )

    const view = renderPreview()
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(filePath))

    view.rerender(
      <MarkdownFilePreview filePath={secondPath} fileName="SECOND.md" metadata={{ size: 15 }} refreshKey={0} />
    )
    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('# Second file')

    resolveFirstRead?.('# Stale file')
    await waitFor(() => expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Second file'))
  })
})
