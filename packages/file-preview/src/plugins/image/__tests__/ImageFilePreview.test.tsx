import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { previewTestDocument } from '../../../__tests__/previewTestDocument'
import ImageFilePreview from '../ImageFilePreview'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn() },
  createUrl: vi.fn(),
  revokeUrl: vi.fn()
}))

vi.unmock('@cherrystudio/ui')
vi.mock('../../../previewContext', () => ({
  usePreviewLogger: () => mocks.logger,
  usePreviewHost: () => ({})
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function FilePreview({ filePath, refreshKey = 0 }: { filePath: string; refreshKey?: number }) {
  return (
    <ImageFilePreview
      key={`${filePath}:${refreshKey}`}
      sourceId={filePath}
      fileName={filePath.split('/').at(-1)!}
      document={previewTestDocument(128, 1, mocks.read, refreshKey)}
    />
  )
}

beforeEach(() => {
  mocks.read.mockResolvedValue(new Uint8Array(128))
  mocks.createUrl.mockReturnValue('blob:preview-test')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeUrl })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('image file preview plugin', () => {
  it('renders source bytes through a Blob URL', async () => {
    render(<FilePreview filePath={'/tmp/photos/drafts/../summer holiday.png'} />)

    const image = await screen.findByAltText('summer holiday.png', undefined, { timeout: 5000 })

    expect(image).toHaveAttribute('src', 'blob:preview-test')
  })

  it.each(['', 'application/octet-stream', ' IMAGE/SVG+XML; charset=utf-8 '])(
    'uses an SVG MIME type when the host supplies %j',
    async (mediaType) => {
      render(
        <ImageFilePreview
          sourceId="logo"
          fileName="logo.svg"
          mediaType={mediaType}
          document={previewTestDocument(128, 1, mocks.read, 0)}
        />
      )

      const image = await screen.findByAltText('logo.svg', undefined, { timeout: 5000 })

      expect(image).toHaveAttribute('src', 'blob:preview-test')
      expect(mocks.createUrl.mock.lastCall?.[0]).toMatchObject({ type: 'image/svg+xml' })
    }
  )

  it('shows loading feedback until the image loads', async () => {
    render(<FilePreview filePath={'/tmp/photos/example.webp'} />)

    const image = await screen.findByAltText('example.webp')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    fireEvent.load(image)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('contains image loading errors inside the preview surface', async () => {
    const view = render(<FilePreview filePath={'/tmp/photos/missing.gif'} />)

    fireEvent.error(await screen.findByAltText('missing.gif'))

    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:preview-test')
    view.unmount()
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(1)
  })

  it('revokes the image Blob URL on unmount', async () => {
    const view = render(<FilePreview filePath="/tmp/image.png" />)
    await screen.findByAltText('image.png')
    view.unmount()
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:preview-test')
  })

  it('provides view-only transform controls in the plugin toolbar', async () => {
    render(<FilePreview filePath={'/tmp/photos/diagram.bmp'} />)

    const image = await screen.findByAltText('diagram.bmp')
    fireEvent.load(image)

    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    const labels = within(toolbar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual([
      'preview.zoom_out',
      'preview.zoom_in',
      'preview.rotate_left',
      'preview.rotate_right',
      'preview.flip_horizontal',
      'preview.flip_vertical',
      'preview.reset'
    ])

    const zoomOut = within(toolbar).getByRole('button', { name: 'preview.zoom_out' })
    expect(zoomOut).toBeDisabled()

    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    expect(image).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1.25) scaleX(1) scaleY(1)'
    })
    expect(zoomOut).toBeEnabled()

    fireEvent.click(zoomOut)
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_left' }))
    expect(image).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(270deg) scale(1) scaleX(1) scaleY(1)'
    })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.flip_horizontal' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.flip_vertical' }))
    expect(image).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(90deg) scale(1.25) scaleX(-1) scaleY(-1)'
    })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.reset' }))
    expect(image).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1) scaleX(1) scaleY(1)'
    })
  })

  it('resets image state when the file path changes', async () => {
    const { rerender } = render(<FilePreview filePath={'/tmp/photos/first.jpg'} />)
    const firstImage = await screen.findByAltText('first.jpg')
    fireEvent.load(firstImage)
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(firstImage).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(90deg) scale(1.25) scaleX(1) scaleY(1)'
    })

    rerender(<FilePreview filePath={'/tmp/photos/second.jpg'} />)

    const secondImage = await screen.findByAltText('second.jpg')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(secondImage).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1) scaleX(1) scaleY(1)'
    })
  })

  it('rebuilds the image preview when the refresh key changes', async () => {
    const filePath = '/tmp/photos/refresh.jpg'
    const { rerender } = render(<FilePreview filePath={filePath} refreshKey={0} />)
    const firstImage = await screen.findByAltText('refresh.jpg')
    fireEvent.load(firstImage)

    rerender(<FilePreview filePath={filePath} refreshKey={1} />)

    const refreshedImage = await screen.findByAltText('refresh.jpg')
    expect(refreshedImage).not.toBe(firstImage)
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
  })
})
