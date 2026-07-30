import '@testing-library/jest-dom/vitest'

import { loggerService } from '@logger'
import { FilePreview } from '@renderer/components/FilePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  window.api.file.getMetadata = vi.fn().mockResolvedValue({
    kind: 'file',
    type: 'image',
    size: 128,
    createdAt: 1,
    modifiedAt: 1,
    mime: 'image/png'
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('image file preview plugin', () => {
  it('renders a local image through a file URL', async () => {
    render(<FilePreview filePath={'/tmp/photos/drafts/../summer holiday.png' as AbsoluteFilePath} />)

    const image = await screen.findByAltText('summer holiday.png')

    expect(image).toHaveAttribute('src', 'file:///tmp/photos/summer%20holiday.png')
    expect(screen.getByTestId('image-preview-viewport').parentElement).toHaveClass('p-4')
  })

  it('renders SVG through a direct file URL instead of the danger-ext directory wrap', async () => {
    render(<FilePreview filePath={'/tmp/art/logo.svg' as AbsoluteFilePath} />)

    const image = await screen.findByRole('img', { name: 'logo.svg' })

    expect(image).toHaveAttribute('src', 'file:///tmp/art/logo.svg')
  })

  it('shows loading feedback until the image loads', async () => {
    render(<FilePreview filePath={'/tmp/photos/example.webp' as AbsoluteFilePath} />)

    const image = await screen.findByAltText('example.webp')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    fireEvent.load(image)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('contains image loading errors inside the preview surface', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    render(<FilePreview filePath={'/tmp/photos/missing.gif' as AbsoluteFilePath} />)

    fireEvent.error(await screen.findByAltText('missing.gif'))

    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('/tmp/photos/missing.gif'), expect.any(Error))
  })

  it('provides view-only transform controls in the plugin toolbar', async () => {
    render(<FilePreview filePath={'/tmp/photos/diagram.bmp' as AbsoluteFilePath} />)

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
    const { rerender } = render(<FilePreview filePath={'/tmp/photos/first.jpg' as AbsoluteFilePath} />)
    const firstImage = await screen.findByAltText('first.jpg')
    fireEvent.load(firstImage)
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(firstImage).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(90deg) scale(1.25) scaleX(1) scaleY(1)'
    })

    rerender(<FilePreview filePath={'/tmp/photos/second.jpg' as AbsoluteFilePath} />)

    const secondImage = await screen.findByAltText('second.jpg')
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(secondImage).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1) scaleX(1) scaleY(1)'
    })
  })

  it('rebuilds the image preview when the refresh key changes', async () => {
    const filePath = '/tmp/photos/refresh.jpg' as AbsoluteFilePath
    const { rerender } = render(<FilePreview filePath={filePath} refreshKey={0} />)
    const firstImage = await screen.findByAltText('refresh.jpg')
    fireEvent.load(firstImage)

    rerender(<FilePreview filePath={filePath} refreshKey={1} />)

    const refreshedImage = await screen.findByAltText('refresh.jpg')
    expect(refreshedImage).not.toBe(firstImage)
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
  })
})
