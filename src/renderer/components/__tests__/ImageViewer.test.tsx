import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type * as ImageUtils from '@renderer/utils/image'

import ImageViewer from '../ImageViewer'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fsRead: vi.fn(),
  transformImageToPng: vi.fn(),
  convertImageToPng: vi.fn(),
  clipboard: {
    write: vi.fn(),
    writeText: vi.fn()
  },
  save: vi.fn(),
  saveImage: vi.fn()
}))

vi.mock('@renderer/utils/image', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageUtils>()
  mocks.convertImageToPng.mockImplementation(actual.convertImageToPng)
  return { ...actual, convertImageToPng: mocks.convertImageToPng, transformImageToPng: mocks.transformImageToPng }
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

describe('ImageViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.fetch.mockResolvedValue({
      blob: async () => new Blob(['remote'], { type: 'image/webp' })
    })
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.saveImage.mockResolvedValue(true)
    mocks.save.mockResolvedValue('/tmp/output.svg')
    mocks.transformImageToPng.mockResolvedValue(new Blob(['transformed'], { type: 'image/png' }))

    Object.assign(window, {
      api: { file: { save: mocks.save, saveImage: mocks.saveImage }, fs: { read: mocks.fsRead } }
    })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mocks.clipboard })
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

  it('saves image data from the context menu with the existing file save flow', async () => {
    render(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.save_as' }))

    await waitFor(() => {
      expect(mocks.saveImage).toHaveBeenCalledWith('Example image', 'data:image/png;base64,aGVsbG8=')
    })
    expect(toast.success).toHaveBeenCalledWith('common.saved')
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
      expect(mocks.saveImage).toHaveBeenCalledWith('Example image', 'data:image/png;base64,dHJhbnNmb3JtZWQ=')
    })
  })

  it.each(['saved', 'canceled', 'failed'])(
    'saves the original SVG bytes despite rotation and flip: %s',
    async (outcome) => {
      const user = userEvent.setup()
      const bytes = new Uint8Array([239, 187, 191, 60, 115, 118, 103, 62, 13, 10, 0, 255])
      const blob = new Blob([bytes], { type: 'image/svg+xml' })
      // jsdom's Blob lacks arrayBuffer; supply the browser API on this source only.
      Object.defineProperty(blob, 'arrayBuffer', { value: async () => bytes.slice().buffer })
      mocks.fetch.mockResolvedValue({ ok: true, blob: async () => blob })
      if (outcome === 'canceled') mocks.save.mockResolvedValue(null)
      if (outcome === 'failed') mocks.save.mockRejectedValue(new Error('save failed'))
      render(
        <ImageViewer
          src="blob:original-svg"
          alt="Original.svg"
          contextMenuTransform={{ rotation: 90, flipX: true, flipY: true }}
          preview={false}
        />
      )
      fireEvent.contextMenu(screen.getByRole('img', { name: 'Original.svg' }))
      await user.click(screen.getByRole('button', { name: 'preview.save_as' }))
      await waitFor(() =>
        expect(mocks.save).toHaveBeenCalledWith('Original.svg', bytes, {
          filters: [{ name: 'files.image', extensions: ['svg'] }]
        })
      )
      expect(mocks.save.mock.calls[0][1]).toBeInstanceOf(Uint8Array)
      expect(mocks.convertImageToPng).not.toHaveBeenCalled()
      expect(mocks.transformImageToPng).not.toHaveBeenCalled()
      expect(mocks.saveImage).not.toHaveBeenCalled()
      if (outcome === 'saved') expect(toast.success).toHaveBeenCalledWith('common.saved')
      if (outcome === 'canceled') {
        expect(toast.success).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
      }
      if (outcome === 'failed') await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.save_failed'))
    }
  )

  it('does not expose a download action in the preview toolbar or context menu', () => {
    render(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.click(screen.getByRole('img', { name: 'Example image' }))
    expect(screen.queryByRole('button', { name: 'common.download' })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getAllByRole('img', { name: 'Example image' })[0])
    expect(screen.queryByRole('button', { name: 'common.download' })).not.toBeInTheDocument()
  })
})
