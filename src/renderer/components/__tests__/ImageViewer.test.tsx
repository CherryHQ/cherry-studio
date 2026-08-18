import '@testing-library/jest-dom/vitest'

import { toast } from '@renderer/services/toast'
import type * as ImageUtils from '@renderer/utils/image'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import ImageViewer from '../ImageViewer'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fsRead: vi.fn(),
  transformImageToPng: vi.fn(),
  clipboard: {
    write: vi.fn(),
    writeText: vi.fn()
  },
  save: vi.fn(),
  saveImage: vi.fn()
}))

vi.mock('@renderer/utils/image', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageUtils>()
  return { ...actual, transformImageToPng: mocks.transformImageToPng }
})

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

const blobArrayBufferDescriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')

beforeAll(() => {
  if (!blobArrayBufferDescriptor) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(this)
        })
      }
    })
  }
})

afterAll(() => {
  if (!blobArrayBufferDescriptor) {
    Reflect.deleteProperty(Blob.prototype, 'arrayBuffer')
  }
})

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.fetch.mockResolvedValue({
      blob: async () => new Blob(['remote'], { type: 'image/webp' })
    })
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.save.mockResolvedValue('/tmp/image')
    mocks.saveImage.mockResolvedValue(true)
    mocks.transformImageToPng.mockResolvedValue(new Blob(['transformed'], { type: 'image/png' }))

    Object.assign(window, {
      api: { file: { save: mocks.save, saveImage: mocks.saveImage }, fs: { read: mocks.fsRead } }
    })
    Object.assign(navigator, { clipboard: mocks.clipboard })
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('opens the shared preview dialog with the save-as toolbar action', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.getByTestId('image-preview-dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'preview.save_as' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'preview.copy.image' })).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'preview.copy.image' }))

    await waitFor(() => {
      expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    })
    expect(toast.success).toHaveBeenCalledWith('message.copy.success')
  })

  it('saves untouched image data with its original bytes and format', async () => {
    render(<ImageViewer src="data:image/webp;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.save_as' }))

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('Example image.webp', new Uint8Array([104, 101, 108, 108, 111]))
    })
    expect(mocks.saveImage).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('common.saved')
  })

  it('uses the original filename suffix when the source MIME is generic', async () => {
    mocks.fetch.mockResolvedValueOnce({
      blob: async () => new Blob(['hello'], { type: 'application/octet-stream' })
    })
    render(<ImageViewer src="https://example.com/source.png" alt="Example image.JPEG" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image.JPEG' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.save_as' }))

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('Example image.jpg', new Uint8Array([104, 101, 108, 108, 111]))
    })
  })

  it('bakes the external content transform when saving from the context menu', async () => {
    render(
      <ImageViewer
        src="data:image/png;base64,aGVsbG8="
        alt="Example image"
        contextMenuTransform={{ flipX: true, offsetX: 20, rotation: -90, zoom: 2 }}
        preview={false}
      />
    )

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.save_as' }))

    await waitFor(() => {
      expect(mocks.transformImageToPng).toHaveBeenCalledWith(expect.any(Blob), {
        flipX: true,
        flipY: false,
        rotation: -90
      })
      expect(mocks.save).toHaveBeenCalledWith(
        'Example image.png',
        new Uint8Array([116, 114, 97, 110, 115, 102, 111, 114, 109, 101, 100])
      )
    })
    expect(mocks.saveImage).not.toHaveBeenCalled()
  })

  it('does not expose a download action in the preview toolbar or context menu', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))
    expect(screen.queryByRole('button', { name: 'common.download' })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getAllByRole('img', { name: 'Example image' })[0])
    expect(screen.queryByRole('button', { name: 'common.download' })).not.toBeInTheDocument()
  })
})
