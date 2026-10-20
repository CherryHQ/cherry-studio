import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  default: (props: { language: string; value: string; wrapped: boolean }) => {
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

  it.each(['file', 'artifact'] as const)(
    'resolves parsed images beside the document in %s mode without navigation',
    async (type) => {
      mocks.readText.mockResolvedValue(
        '![](images/diagram.png)\n\n![](./icon.svg)\n\n![reference][x]\n\n[x]: ../images/diagram.png?v=1#detail'
      )
      const { container } = renderPreview({ filePath: '/tmp/docs/note.md' as AbsoluteFilePath, type })

      await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3))
      expect(Array.from(container.querySelectorAll('img'), (image) => image.getAttribute('src'))).toEqual([
        'file:///tmp/docs/images/diagram.png',
        'file:///tmp/docs/icon.svg',
        'file:///tmp/images/diagram.png?v=1#detail'
      ])
    }
  )

  it('keeps authored image destinations in source mode', async () => {
    const source = '![](images/diagram.png)\n\n![](./icon.svg)'
    mocks.readText.mockResolvedValue(source)
    const user = userEvent.setup()
    renderPreview()
    await user.click(await screen.findByRole('button', { name: 'file_preview.markdown.mode.source' }))
    expect(await screen.findByTestId('code-viewer')).toHaveTextContent('![](images/diagram.png) ![](./icon.svg)')
  })

  it.each([
    ['', 'images/missing.png'],
    ['Architecture', 'Architecture']
  ])('names a failed relative image with alt %j', async (alt, label) => {
    mocks.readText.mockResolvedValue(`![${alt}](images/missing.png)`)
    const { container } = renderPreview()
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    fireEvent.error(container.querySelector('img')!)

    const placeholder = screen.getByRole('img', { name: label })
    expect(placeholder).toHaveTextContent(label)
    expect(placeholder.tagName).toBe('SPAN')
  })

  it('uses the new document directory after an image failed in the previous document', async () => {
    mocks.readText.mockResolvedValue('![diagram](images/diagram.png)')
    const view = renderPreview()
    fireEvent.error(await screen.findByRole('img', { name: 'diagram' }))
    expect(screen.getByRole('img', { name: 'diagram' }).tagName).toBe('SPAN')

    view.rerender(
      <MarkdownFilePreview
        filePath={'/tmp/other/note.md' as AbsoluteFilePath}
        fileName="note.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'diagram' })).toHaveAttribute(
        'src',
        'file:///tmp/other/images/diagram.png'
      )
    )
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

  it('reloads content when the path or refresh key changes', async () => {
    const secondPath = '/tmp/workspace/CHANGELOG.md' as AbsoluteFilePath
    const view = renderPreview()
    expect(await screen.findByRole('heading')).toHaveTextContent('File preview')
    mocks.readText.mockResolvedValueOnce('# Second document')
    view.rerender(
      <MarkdownFilePreview
        filePath={secondPath}
        fileName="CHANGELOG.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    expect(await screen.findByRole('heading')).toHaveTextContent('Second document')
    mocks.readText.mockResolvedValueOnce('# Refreshed document')
    view.rerender(
      <MarkdownFilePreview
        filePath={secondPath}
        fileName="CHANGELOG.md"
        metadata={{ size: 15, modifiedAt: 1 }}
        refreshKey={1}
      />
    )
    expect(await screen.findByRole('heading')).toHaveTextContent('Refreshed document')
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
