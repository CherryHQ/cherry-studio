import { Blob as NativeBlob } from 'node:buffer'

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { toast } from '@renderer/services/toast'
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
  return { ...actual, transformImageToPng: mocks.transformImageToPng }
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
        src="data:image/png;base64,aGVsbG8="
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
