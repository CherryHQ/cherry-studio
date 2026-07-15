import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as FilePreviewRegistryModule from '../filePreviewRegistry'

const mocks = vi.hoisted(() => ({
  extensionLoad: vi.fn(),
  fallbackLoad: vi.fn()
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

  return {
    ...actual,
    filePreviewRegistry: actual.createFilePreviewRegistry({
      extensionPlugins: [{ id: 'markdown', extensions: ['md'], load: mocks.extensionLoad }],
      textFallbackPlugin: { id: 'text', extensions: [], load: mocks.fallbackLoad }
    })
  }
})

import { FilePreview } from '../FilePreview'

const isTextFile = vi.fn()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.assign(window.api.file, { isTextFile })
  isTextFile.mockReset()
  mocks.extensionLoad.mockReset()
  mocks.fallbackLoad.mockReset()
  mocks.extensionLoad.mockResolvedValue({ default: () => <div data-testid="extension-preview" /> })
  mocks.fallbackLoad.mockResolvedValue({
    default: ({ filePath }: { filePath: FilePath }) => <div data-testid="text-preview" data-file-path={filePath} />
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('FilePreview text fallback', () => {
  it('loads the text fallback after an unknown file is detected as text', async () => {
    isTextFile.mockResolvedValue(true)

    render(<FilePreview filePath={'/tmp/README' as FilePath} />)

    expect(await screen.findByTestId('text-preview')).toHaveAttribute('data-file-path', '/tmp/README')
    expect(isTextFile).toHaveBeenCalledWith('/tmp/README')
    expect(mocks.fallbackLoad).toHaveBeenCalledTimes(1)
  })

  it('does not probe content when an extension plugin matches', async () => {
    render(<FilePreview filePath={'/tmp/README.md' as FilePath} />)

    expect(await screen.findByTestId('extension-preview')).toBeInTheDocument()
    expect(isTextFile).not.toHaveBeenCalled()
    expect(mocks.fallbackLoad).not.toHaveBeenCalled()
  })

  it('shows unsupported state when the fallback probe detects binary content', async () => {
    isTextFile.mockResolvedValue(false)

    render(<FilePreview filePath={'/tmp/archive' as FilePath} />)

    expect(await screen.findByText('file_preview.unsupported.title')).toBeInTheDocument()
    expect(mocks.fallbackLoad).not.toHaveBeenCalled()
  })

  it('shows an inline error when the fallback probe fails', async () => {
    isTextFile.mockRejectedValue(new Error('file missing'))

    render(<FilePreview filePath={'/tmp/missing' as FilePath} />)

    expect(await screen.findByText('file_preview.probe_error.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.probe_error.description')).toBeInTheDocument()
    expect(mocks.fallbackLoad).not.toHaveBeenCalled()
  })

  it('does not reuse a completed text probe when the file path changes', async () => {
    let resolveSecondProbe: ((isText: boolean) => void) | undefined
    isTextFile
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveSecondProbe = resolve)))
    const { rerender } = render(<FilePreview filePath={'/tmp/first' as FilePath} />)
    expect(await screen.findByTestId('text-preview')).toHaveAttribute('data-file-path', '/tmp/first')

    rerender(<FilePreview filePath={'/tmp/second' as FilePath} />)

    expect(screen.queryByTestId('text-preview')).not.toBeInTheDocument()
    expect(screen.getByText('file_preview.loading')).toBeInTheDocument()

    resolveSecondProbe?.(true)
    expect(await screen.findByTestId('text-preview')).toHaveAttribute('data-file-path', '/tmp/second')
  })
})
