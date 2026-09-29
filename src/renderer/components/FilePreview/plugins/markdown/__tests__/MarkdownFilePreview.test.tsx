import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { AbsoluteFilePath } from '@shared/types/file'

import type { FilePreviewType } from '../../../types'
import MarkdownFilePreview from '../MarkdownFilePreview'

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

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
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
  )
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
      metadata={{ size: overrides.size ?? 15, modifiedAt: 1 }}
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

    expect(await screen.findByRole('heading')).toHaveTextContent('File preview')
    expect(mocks.readText).toHaveBeenCalledWith(filePath)
  })

  it('shows the empty state for empty content', async () => {
    mocks.readText.mockResolvedValueOnce('')

    renderPreview({ size: 0 })

    expect(await screen.findByText('file_preview.markdown.empty.title')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
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
    await screen.findByRole('heading')

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.markdown.mode.source' }))

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('File preview')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'markdown', value: '# File preview', wrapped: true })
    )

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.markdown.mode.preview' }))
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })

  // A document over the render budget used to go through the Markdown pipeline in one
  // synchronous pass and block the renderer until it finished.
  it('shows plain source instead of rendering a document over the rich render budget', async () => {
    mocks.readText.mockResolvedValueOnce('# File preview')

    renderPreview({ size: 1024 * 1024 + 1, type: 'artifact' })

    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('# File preview')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('file_preview.markdown.plain_fallback.description')
    expect(mocks.codeViewer).toHaveBeenLastCalledWith(expect.objectContaining({ options: { highlight: false } }))
  })

  it('locks the view switch so a plain-text document cannot be forced through rendering', async () => {
    mocks.readText.mockResolvedValueOnce('# File preview')

    renderPreview({ size: 1024 * 1024 + 1 })

    await screen.findByTestId('code-viewer')
    expect(screen.getByRole('button', { name: 'file_preview.markdown.mode.preview' })).toBeDisabled()
  })

  it('shows plain source for a document dominated by very long lines', async () => {
    mocks.readText.mockResolvedValueOnce('a'.repeat(60_000))

    renderPreview({ size: 60_000 })

    expect(await screen.findByTestId('code-viewer')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('keeps rendering a document that fits the render budget', async () => {
    mocks.readText.mockResolvedValueOnce('# File preview')

    renderPreview({ size: 1024 * 1024 })

    expect(await screen.findByRole('heading')).toHaveTextContent('File preview')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('hides frontmatter and the source switch when the artifact host owns editing', async () => {
    mocks.readText.mockResolvedValueOnce(
      '---\r\nname: Writer\r\ndescription: Draft clear prose\r\n---\r\n# File preview'
    )
    renderPreview({ type: 'artifact' })

    expect(await screen.findByRole('heading')).toHaveTextContent('File preview')
    expect(screen.getByRole('heading')).not.toHaveTextContent('name: Writer')
    expect(screen.getByRole('heading')).not.toHaveTextContent('description: Draft clear prose')
    expect(screen.queryByRole('button', { name: 'file_preview.markdown.mode.preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file_preview.markdown.mode.source' })).not.toBeInTheDocument()
  })

  it('reloads when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/CHANGELOG.md' as AbsoluteFilePath
    const view = renderPreview()
    await screen.findByRole('heading')

    view.rerender(
      <MarkdownFilePreview
        filePath={secondPath}
        fileName="CHANGELOG.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledWith(secondPath))

    view.rerender(
      <MarkdownFilePreview
        filePath={secondPath}
        fileName="CHANGELOG.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={1}
      />
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
      <MarkdownFilePreview
        filePath={secondPath}
        fileName="SECOND.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    expect(await screen.findByRole('heading')).toHaveTextContent('Second file')

    resolveFirstRead?.('# Stale file')
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Second file'))
  })
})
