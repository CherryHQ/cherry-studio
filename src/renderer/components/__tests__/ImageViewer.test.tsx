import '@testing-library/jest-dom/vitest'

import { toast } from '@renderer/services/toast'
import type * as ImageUtils from '@renderer/utils/image'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageViewer, { saveImageFromSource } from '../ImageViewer'

const mocks = vi.hoisted(() => ({
  convertImageToPng: vi.fn(),
  fetch: vi.fn(),
  fsRead: vi.fn(),
  fileSave: vi.fn(),
  clipboard: {
    write: vi.fn(),
    writeText: vi.fn()
  }
}))

// Keep the real image utils (getImageBlobFromSource drives copy/save here) and
// override only the PNG conversion the clipboard path depends on.
vi.mock('@renderer/utils/image', async (importActual) => ({
  ...(await importActual<typeof ImageUtils>()),
  convertImageToPng: mocks.convertImageToPng
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

class MockClipboardItem {
  items: Record<string, Blob>

  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.convertImageToPng.mockImplementation(async (blob: Blob) => blob)
    mocks.fetch.mockResolvedValue({
      blob: async () => new Blob(['remote'], { type: 'image/webp' })
    })
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))

    Object.assign(window, {
      api: { file: { save: mocks.fileSave }, fs: { read: mocks.fsRead } }
    })
    Object.assign(navigator, { clipboard: mocks.clipboard })
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('opens the shared preview dialog when clicked', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.getByTestId('image-preview-dialog')).toBeInTheDocument()
  })

  it('respects preview=false', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" preview={false} />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.queryByTestId('image-preview-dialog')).not.toBeInTheDocument()
  })

  it('copies image source from the context menu', async () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.copy.src' }))

    await waitFor(() => {
      expect(mocks.clipboard.writeText).toHaveBeenCalledWith('https://example.com/image.png')
    })
    expect(toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('copies image data from the context menu', async () => {
    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(mocks.convertImageToPng).toHaveBeenCalled()
    })
    expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    expect(toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('shows download success after the image is saved from the context menu', async () => {
    let resolveSave: (path: string) => void = () => {}
    mocks.fileSave.mockReturnValue(new Promise<string>((resolve) => (resolveSave = resolve)))

    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.download' }))

    await waitFor(() => {
      expect(mocks.fileSave).toHaveBeenCalledWith('image.png', expect.any(Uint8Array))
    })
    expect(toast.success).not.toHaveBeenCalled()

    resolveSave('/tmp/image.png')

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('message.download.success')
    })
  })

  it('shows download failure when saving the image fails from the context menu', async () => {
    mocks.fileSave.mockRejectedValue(new Error('save failed'))

    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.download' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('message.download.failed')
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('saves non-base64 inline image data URLs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%"><text>hello</text></svg>'
    mocks.fileSave.mockResolvedValue('/tmp/vector.svg')

    await saveImageFromSource(`data:image/svg+xml,${svg}`)

    expect(mocks.fileSave).toHaveBeenCalledWith('image.svg', expect.any(Uint8Array))
    const bytes = mocks.fileSave.mock.calls[0][1] as Uint8Array
    expect(new TextDecoder().decode(bytes)).toBe(svg)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sanitizes decoded URL filenames before showing the save dialog', async () => {
    mocks.fileSave.mockResolvedValue('/tmp/evil.png')

    await saveImageFromSource('https://example.com/images/%2Ftmp%2Fevil%5Cname.png')

    expect(mocks.fileSave).toHaveBeenCalledWith('_tmp_evil_name.png', expect.any(Uint8Array))
  })
})
