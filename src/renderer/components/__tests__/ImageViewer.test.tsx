import { Blob as NativeBlob } from 'node:buffer'

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { toast } from '@renderer/services/toast'
import { convertImageToPng } from '@renderer/utils/image'
import type * as ImageUtils from '@renderer/utils/image'

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
  return {
    ...actual,
    convertImageToPng: vi.fn(actual.convertImageToPng),
    transformImageToPng: mocks.transformImageToPng
  }
})

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
const renderWithI18n = (ui: ReactNode) =>
  render(ui, { wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider> })

vi.unmock('react-i18next')

class MockClipboardItem {
  items: Record<string, Blob>

  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

describe('ImageViewer', () => {
  let user: ReturnType<typeof userEvent.setup>
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()

    mocks.fetch.mockResolvedValue({
      blob: async () => new Blob(['remote'], { type: 'image/webp' })
    })
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.save.mockResolvedValue('animation.gif')
    mocks.saveImage.mockResolvedValue(true)
    mocks.transformImageToPng.mockResolvedValue(new Blob(['transformed'], { type: 'image/png' }))

    Object.assign(window, {
      api: { file: { saveImage: mocks.saveImage, save: mocks.save }, fs: { read: mocks.fsRead } }
    })
    vi.spyOn(navigator.clipboard, 'write').mockImplementation(mocks.clipboard.write)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(mocks.clipboard.writeText)
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('opens the shared preview dialog', async () => {
    renderWithI18n(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    await user.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.getByTestId('image-preview-dialog')).toBeInTheDocument()
  })

  it('respects preview=false', async () => {
    renderWithI18n(<ImageViewer src="https://example.com/image.png" alt="Example image" preview={false} />)

    await user.click(screen.getByRole('img', { name: 'Example image' }))

    expect(screen.queryByTestId('image-preview-dialog')).not.toBeInTheDocument()
  })

  it('copies image source from the context menu', async () => {
    renderWithI18n(<ImageViewer src="https://example.com/image.png" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    await user.click(screen.getByRole('button', { name: 'Copy Image Source' }))

    await waitFor(() => {
      expect(mocks.clipboard.writeText).toHaveBeenCalledWith('https://example.com/image.png')
    })
    expect(toast.success).toHaveBeenCalledWith(en['message.copy.success'])
  })

  it('copies image data from the context menu', async () => {
    renderWithI18n(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    await user.click(screen.getByRole('button', { name: 'Copy as image' }))

    await waitFor(() => {
      expect(mocks.clipboard.write).toHaveBeenCalledWith([expect.any(MockClipboardItem)])
    })
    expect(toast.success).toHaveBeenCalledWith(en['message.copy.success'])
  })

  it('saves image data from the context menu with the existing file save flow', async () => {
    renderWithI18n(<ImageViewer src="data:image/png;base64,aGVsbG8=" alt="Example image" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    await user.click(screen.getByRole('button', { name: 'Save As' }))

    await waitFor(() => {
      expect(mocks.saveImage).toHaveBeenCalledWith('Example image', 'data:image/png;base64,aGVsbG8=')
    })
    expect(toast.success).toHaveBeenCalledWith(en['common.saved'])
  })

  it('bakes the external content transform when saving from the context menu', async () => {
    renderWithI18n(
      <ImageViewer
        src="data:image/jpeg;base64,/9j/4QECAwD/2Q=="
        alt="Example image"
        contextMenuTransform={{ flipX: true, offsetX: 20, rotation: -90, zoom: 2 }}
        preview={false}
      />
    )

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Example image' }))
    await user.click(screen.getByRole('button', { name: 'Save As' }))

    await waitFor(() => {
      expect(mocks.transformImageToPng).toHaveBeenCalledWith(expect.any(Blob), {
        flipX: true,
        flipY: false,
        rotation: -90
      })
      expect(mocks.saveImage).toHaveBeenCalledWith('Example image', 'data:image/png;base64,dHJhbnNmb3JtZWQ=')
    })
  })

  it.each([
    {
      source: 'data:image/jpeg;base64,/9j/4QECAwD/2Q==',
      filename: 'Original.jpg',
      label: 'JPEG',
      extension: 'jpg',
      bytes: new Uint8Array([255, 216, 255, 225, 1, 2, 3, 0, 255, 217])
    },
    {
      source: 'data:image/webp;base64,UklGRgQAAABXRUJQ',
      filename: 'Original.webp',
      label: 'WEBP',
      extension: 'webp',
      bytes: new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])
    },
    {
      source: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>原图</text></svg>')}`,
      filename: 'Original.svg',
      label: 'SVG',
      extension: 'svg',
      bytes: Uint8Array.from(
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>原图</text></svg>')
      )
    }
  ])(
    'saves original bytes as $filename without baking zoom or pan',
    async ({ source, filename, label, extension, bytes }) => {
      vi.stubGlobal('Blob', NativeBlob)
      renderWithI18n(
        <ImageViewer
          src={source}
          alt={filename}
          contextMenuTransform={{ offsetX: 20, offsetY: -30, rotation: 360, zoom: 2 }}
        />
      )

      fireEvent.contextMenu(screen.getByRole('img', { name: filename }))
      await user.click(screen.getByRole('button', { name: 'Save As' }))

      await waitFor(() =>
        expect(mocks.save).toHaveBeenCalledWith(filename, bytes, {
          filters: [{ name: label, extensions: [extension] }]
        })
      )
      expect(mocks.saveImage).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith(en['common.saved'])
    }
  )

  it.each(['', 'image/x-unknown', 'application/octet-stream'])(
    'converts a source with MIME %j to PNG instead of guessing its extension',
    async (type) => {
      mocks.fetch.mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['original'], { type }) })
      vi.mocked(convertImageToPng).mockResolvedValueOnce(new Blob(['converted'], { type: 'image/png' }))
      renderWithI18n(<ImageViewer src="https://example.com/image" alt="Unknown" />)

      fireEvent.contextMenu(screen.getByRole('img', { name: 'Unknown' }))
      await user.click(screen.getByRole('button', { name: 'Save As' }))

      await waitFor(() => expect(mocks.saveImage).toHaveBeenCalledWith('Unknown', 'data:image/png;base64,Y29udmVydGVk'))
      expect(mocks.save).not.toHaveBeenCalled()
    }
  )

  it('saves original bytes again after a completed save', async () => {
    vi.stubGlobal('Blob', NativeBlob)
    renderWithI18n(<ImageViewer src="data:image/jpeg;base64,/9j/4QECAwD/2Q==" alt="Original.jpg" />)

    for (const call of [1, 2]) {
      fireEvent.contextMenu(screen.getByRole('img', { name: 'Original.jpg' }))
      await user.click(screen.getByRole('button', { name: 'Save As' }))

      await waitFor(() =>
        expect(mocks.save).toHaveBeenNthCalledWith(
          call,
          'Original.jpg',
          new Uint8Array([255, 216, 255, 225, 1, 2, 3, 0, 255, 217]),
          { filters: [{ name: 'JPEG', extensions: ['jpg'] }] }
        )
      )
    }
  })

  it('reports a failed original-byte save and allows retrying', async () => {
    vi.stubGlobal('Blob', NativeBlob)
    mocks.save.mockRejectedValueOnce(new Error('Disk full'))
    renderWithI18n(<ImageViewer src="data:image/webp;base64,UklGRgQAAABXRUJQ" alt="Original.webp" />)

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Original.webp' }))
    await user.click(screen.getByRole('button', { name: 'Save As' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en['common.save_failed']))
    expect(toast.success).not.toHaveBeenCalled()

    fireEvent.contextMenu(screen.getByRole('img', { name: 'Original.webp' }))
    await user.click(screen.getByRole('button', { name: 'Save As' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en['common.saved']))
    expect(mocks.save).toHaveBeenLastCalledWith(
      'Original.webp',
      new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
      { filters: [{ name: 'WEBP', extensions: ['webp'] }] }
    )
    expect(mocks.saveImage).not.toHaveBeenCalled()
  })

  it.each([{}, { rotation: 90, flipX: true }, { flipY: true }])(
    'preserves original GIF bytes after preview transforms %j',
    async (transform) => {
      // JSDOM's Blob lacks arrayBuffer; Node provides the same standard binary API as Chromium.
      vi.stubGlobal('Blob', NativeBlob)
      const source =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAUAAAALAAAAAABAAEAAAICTAEAOw=='
      renderWithI18n(<ImageViewer src={source} alt="Animation" contextMenuTransform={transform} />)
      fireEvent.contextMenu(screen.getByRole('img', { name: 'Animation' }))
      await user.click(screen.getByRole('button', { name: 'Save As' }))
      await waitFor(() =>
        expect(mocks.save).toHaveBeenCalledWith(
          'Animation.gif',
          Uint8Array.from(atob(source.split(',')[1]), (c) => c.charCodeAt(0)),
          { filters: [{ name: 'GIF', extensions: ['gif'] }] }
        )
      )
    }
  )
})
