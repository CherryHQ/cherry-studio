import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FilePreviewRegistryModule from '../filePreviewRegistry'

const mocks = vi.hoisted(() => ({
  load: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  )
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
  mocks.load.mockReset()
  mocks.load.mockResolvedValue({
    default: ({ filePath, fileName, refreshKey }: { filePath: FilePath; fileName: string; refreshKey: number }) => (
      <div
        data-testid="plugin-preview"
        data-file-path={filePath}
        data-file-name={fileName}
        data-refresh-key={refreshKey}
      />
    )
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('FilePreview plugin loading', () => {
  it('shows a localized loading state while the plugin is pending', () => {
    mocks.load.mockImplementationOnce(() => new Promise(() => {}))

    render(<FilePreview filePath={'/tmp/README.md' as FilePath} />)

    expect(screen.getByText('file_preview.loading')).toBeInTheDocument()
  })

  it('lazy loads a matching plugin with the canonical file descriptor', async () => {
    render(<FilePreview filePath={'/tmp/workspace/notes/../README.md' as FilePath} refreshKey={4} />)

    expect(await screen.findByTestId('plugin-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/README.md')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-file-name', 'README.md')
    expect(screen.getByTestId('plugin-preview')).toHaveAttribute('data-refresh-key', '4')
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('contains plugin loader failures inside the preview surface', async () => {
    mocks.load.mockRejectedValueOnce(new Error('failed to fetch plugin chunk'))

    render(<FilePreview filePath={'/tmp/README.md' as FilePath} />)

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.load_error.description')).toBeInTheDocument()
  })

  it('contains plugin render failures inside the preview surface', async () => {
    mocks.load.mockResolvedValueOnce({
      default: () => {
        throw new Error('plugin render failed')
      }
    })

    render(<FilePreview filePath={'/tmp/README.md' as FilePath} />)

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.load_error.description')).toBeInTheDocument()
  })
})
