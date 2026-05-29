import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageViewer, { getImageBlobFromSource } from '../ImageViewer'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  convertImageToPng: vi.fn(),
  fetch: vi.fn(),
  fsRead: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn()
  },
  clipboard: {
    write: vi.fn(),
    writeText: vi.fn()
  }
}))

vi.mock('@renderer/utils/download', () => ({
  download: mocks.download
}))

vi.mock('@renderer/utils/image', () => ({
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
      api: { fs: { read: mocks.fsRead } },
      toast: mocks.toast
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
    expect(mocks.toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('copies image data from the context menu', async () => {
    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(mocks.convertImageToPng).toHaveBeenCalled()
    })
    expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    expect(mocks.toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('downloads the image from the context menu', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.download' }))

    expect(mocks.download).toHaveBeenCalledWith('https://example.com/image.png')
  })

  it('reads image blobs from data URLs', async () => {
    const blob = await getImageBlobFromSource('data:image/png;base64,aGVsbG8=')

    expect(blob.type).toBe('image/png')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.fsRead).not.toHaveBeenCalled()
  })

  it('reads image blobs from file URLs', async () => {
    const blob = await getImageBlobFromSource('file:///tmp/example.png')

    expect(mocks.fsRead).toHaveBeenCalledWith('file:///tmp/example.png')
    expect(blob.type).toBe('image/png')
  })

  it('reads image blobs from remote URLs', async () => {
    const blob = await getImageBlobFromSource('https://example.com/image.webp')

    expect(mocks.fetch).toHaveBeenCalledWith('https://example.com/image.webp')
    expect(blob.type).toBe('image/webp')
  })
})
