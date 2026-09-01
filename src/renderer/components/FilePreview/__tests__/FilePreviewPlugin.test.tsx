import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import { FilePreviewLayout } from '../FilePreviewLayout'
import type * as FilePreviewRegistryModule from '../filePreviewRegistry'
import { FilePreviewToolbar } from '../FilePreviewToolbar'

const mocks = vi.hoisted(() => ({
  ipcApiRequest: vi.fn(),
  load: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcApiRequest }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../filePreviewRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof FilePreviewRegistryModule>()
  const plugin = {
    id: 'markdown',
    extensions: ['md'],
    load: mocks.load
  }

  return {
    ...actual,
    filePreviewRegistry: actual.createFilePreviewRegistry({ extensionPlugins: [plugin] })
  }
})

import { FilePreview } from '../FilePreview'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.ipcApiRequest.mockResolvedValue({
    kind: 'file',
    type: 'text',
    size: 128,
    createdAt: 1,
    modifiedAt: 1,
    mime: 'text/markdown'
  })
  mocks.load.mockReset()
  mocks.load.mockResolvedValue({
    default: ({
      filePath,
      fileName,
      metadata,
      refreshKey,
      type
    }: {
      filePath: AbsoluteFilePath
      fileName: string
      metadata: { size: number }
      refreshKey: number
      type?: string
    }) => (
      <FilePreviewLayout.Frame>
        <FilePreviewToolbar aria-label="Preview tools">
          <button type="button">Zoom in</button>
        </FilePreviewToolbar>
        <FilePreviewLayout.Content>
          <div
            data-testid="plugin-preview"
            data-file-path={filePath}
            data-file-name={fileName}
            data-file-size={metadata.size}
            data-refresh-key={refreshKey}
            data-preview-type={type}
          />
        </FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('FilePreview plugin loading', () => {
  it('preloads the matching plugin while metadata is pending and reuses that load', async () => {
    let resolveMetadata: (metadata: {
      kind: 'file'
      type: 'text'
      size: number
      createdAt: number
      modifiedAt: number
      mime: string
    }) => void
    mocks.ipcApiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )

    render(<FilePreview filePath={'/tmp/README.md' as AbsoluteFilePath} />)

    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce())
    expect(screen.getByText('file_preview.loading')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-preview')).not.toBeInTheDocument()

    resolveMetadata!({
      kind: 'file',
      type: 'text',
      size: 128,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/markdown'
    })

    expect(await screen.findByTestId('plugin-preview')).toBeInTheDocument()
    expect(mocks.load).toHaveBeenCalledOnce()
  })

  it('shows a localized loading state while the plugin is pending', () => {
    mocks.load.mockImplementationOnce(() => new Promise(() => {}))

    render(<FilePreview filePath={'/tmp/README.md' as AbsoluteFilePath} />)

    expect(screen.getByText('file_preview.loading')).toBeInTheDocument()
  })

  it('lazy loads a matching plugin with the canonical file descriptor', async () => {
    render(
      <FilePreview filePath={'/tmp/workspace/notes/../README.md' as AbsoluteFilePath} refreshKey={4} type="artifact" />
    )

    expect(await screen.findByTestId('plugin-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/README.md')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-file-name', 'README.md')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-file-size', '128')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-refresh-key', '4')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-preview-type', 'artifact')
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('places an embedded header on the left and the plugin toolbar on the right of one row', async () => {
    render(
      <FilePreview
        filePath={'/tmp/README.md' as AbsoluteFilePath}
        header={<span data-testid="preview-title">README.md</span>}
      />
    )

    const toolbar = await screen.findByRole('toolbar', { name: 'Preview tools' })
    const header = screen.getByTestId('file-preview-header')
    const toolbarHost = screen.getByTestId('file-preview-toolbar-host')

    expect(header).toHaveClass('h-11', 'after:left-3', 'after:right-3', 'after:border-border', 'after:border-b')
    expect(header.nextElementSibling).not.toHaveClass('px-3')
    expect(header.firstElementChild).toContainElement(screen.getByTestId('preview-title'))
    expect(header.lastElementChild).toBe(toolbarHost)
    expect(toolbarHost).toContainElement(toolbar)
  })

  it('contains plugin loader failures inside the preview surface', async () => {
    mocks.load.mockRejectedValueOnce(new Error('failed to fetch plugin chunk'))

    render(<FilePreview filePath={'/tmp/README.md' as AbsoluteFilePath} />)

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.load_error.description')).toBeInTheDocument()
  })

  it('contains plugin render failures inside the preview surface', async () => {
    mocks.load.mockResolvedValueOnce({
      default: () => {
        throw new Error('plugin render failed')
      }
    })

    render(<FilePreview filePath={'/tmp/README.md' as AbsoluteFilePath} />)

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.load_error.description')).toBeInTheDocument()
  })
})
