/* eslint-disable simple-import-sort/imports */
import '@testing-library/jest-dom/vitest'

import { safeOpen } from '@renderer/utils/file/safeOpen'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePreview, __filePreviewInternal } from '../FilePreview'

const mocks = vi.hoisted(() => ({
  ipcApiRequest: vi.fn(),
  textPreview: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcApiRequest }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({
    icon: Icon,
    title,
    description,
    actionLabel,
    onAction
  }: {
    icon?: ComponentType<{ size?: number }>
    title?: string
    description?: string
    actionLabel?: string
    onAction?: () => void
  }) => (
    <div data-testid="empty-state">
      {Icon ? <Icon /> : null}
      <div>{title}</div>
      <div>{description}</div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: vi.fn(() => Promise.resolve())
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('../plugins/text/textFilePreviewPlugin', () => ({
  textFilePreviewPlugin: {
    id: 'text',
    extensions: [],
    load: async () => ({
      default: () => {
        mocks.textPreview()
        return <div data-testid="text-file-preview" />
      }
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => {
  __filePreviewInternal.resetLoadedModules()
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.ipcApiRequest.mockResolvedValue({
    kind: 'file',
    type: 'other',
    size: 1,
    createdAt: 1,
    modifiedAt: 1,
    mime: 'application/octet-stream'
  })
})

describe('FilePreview', () => {
  it('shows unsupported state for an existing binary file without a preview plugin', async () => {
    render(<FilePreview filePath={'/tmp/report.zip' as AbsoluteFilePath} />)

    expect(await screen.findByText('file_preview.unsupported.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.unsupported.description')).toBeInTheDocument()
    expect(screen.getByText('file_preview.unsupported.title').closest('[data-ui~="file-preview.view"]')).not.toBeNull()
  })

  it('contains invalid paths in an inline state', () => {
    render(<FilePreview filePath={'relative/report.pdf' as AbsoluteFilePath} />)

    expect(screen.getByText('file_preview.invalid_path.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.invalid_path.description')).toBeInTheDocument()
  })

  it('opens unsupported files with the default app through safeOpen', async () => {
    const path = '/tmp/report.zip'
    render(<FilePreview filePath={path as AbsoluteFilePath} />)

    fireEvent.click(await screen.findByRole('button', { name: 'file_preview.unsupported.action' }))

    expect(safeOpen).toHaveBeenCalledWith(createFilePathHandle(normalizeFilePreviewPath(path)))
  })

  it('does not offer an external open for invalid paths', () => {
    render(<FilePreview filePath={'relative/report.pdf' as AbsoluteFilePath} />)

    expect(screen.queryByRole('button', { name: 'file_preview.unsupported.action' })).not.toBeInTheDocument()
  })

  it('keeps directories out of file preview plugins', async () => {
    mocks.ipcApiRequest.mockResolvedValueOnce({
      kind: 'directory',
      size: 0,
      createdAt: 1,
      modifiedAt: 1
    })

    render(<FilePreview filePath={'/tmp/artifacts' as AbsoluteFilePath} />)

    expect(await screen.findByText('file_preview.directory.title')).toBeInTheDocument()
    expect(mocks.ipcApiRequest).toHaveBeenCalledOnce()
  })

  it('shows an unavailable state when metadata cannot be read', async () => {
    mocks.ipcApiRequest.mockRejectedValueOnce(new Error('ENOENT'))

    render(<FilePreview filePath={'/tmp/missing.txt' as AbsoluteFilePath} />)

    expect(await screen.findByText('file_preview.unavailable.title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file_preview.unsupported.action' })).not.toBeInTheDocument()
  })

  it('falls back to text preview for text content with an unknown extension', async () => {
    mocks.ipcApiRequest.mockResolvedValueOnce({
      kind: 'file',
      type: 'text',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/plain'
    })

    render(<FilePreview filePath={'/tmp/Dockerfile.generated' as AbsoluteFilePath} />)

    expect(await screen.findByTestId('text-file-preview')).toBeInTheDocument()
    expect(mocks.textPreview).toHaveBeenCalledTimes(1)
  })

  it('kicks off the plugin chunk load in parallel with metadata IPC (#19605)', async () => {
    // Slow IPC, fast plugin: plugin load fires while metadata is still in-flight.
    let resolveMetadata: (value: unknown) => void = () => undefined
    mocks.ipcApiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve
        })
    )

    render(<FilePreview filePath={'/tmp/source.JSON' as AbsoluteFilePath} />)

    // Wait two microtask ticks for the async effect to schedule both operations.
    await Promise.resolve()
    await Promise.resolve()

    // Metadata IPC has been called (still pending), proving the effect ran.
    expect(mocks.ipcApiRequest).toHaveBeenCalledTimes(1)

    // Resolve metadata; component transitions to ready and renders the text preview.
    resolveMetadata({
      kind: 'file',
      type: 'text',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/plain'
    })

    expect(await screen.findByTestId('text-file-preview')).toBeInTheDocument()
  })
})
