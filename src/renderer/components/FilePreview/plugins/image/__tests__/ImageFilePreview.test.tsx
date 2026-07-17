import '@testing-library/jest-dom/vitest'

import { loggerService } from '@logger'
import { FilePreview } from '@renderer/components/FilePreview'
import type { FilePath } from '@shared/types/file'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('image file preview plugin', () => {
  it('renders a local image through a safe file URL', async () => {
    render(<FilePreview filePath={'/tmp/photos/drafts/../summer holiday.png' as FilePath} />)

    expect(await screen.findByRole('img', { name: 'summer holiday.png' })).toHaveAttribute(
      'src',
      'file:///tmp/photos/summer%20holiday.png'
    )
  })

  it('shows loading feedback until the image loads', async () => {
    render(<FilePreview filePath={'/tmp/photos/example.webp' as FilePath} />)

    const image = await screen.findByRole('img', { name: 'example.webp' })
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')

    fireEvent.load(image)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('contains image loading errors inside the preview surface', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    render(<FilePreview filePath={'/tmp/photos/missing.gif' as FilePath} />)

    fireEvent.error(await screen.findByRole('img', { name: 'missing.gif' }))

    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('/tmp/photos/missing.gif'), expect.any(Error))
  })

  it('provides view-only transform controls in the plugin toolbar', async () => {
    render(<FilePreview filePath={'/tmp/photos/diagram.bmp' as FilePath} />)

    const image = await screen.findByRole('img', { name: 'diagram.bmp' })
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
    expect(image).toHaveStyle({ transform: 'scale(1.25) rotate(0deg) scaleX(1) scaleY(1)' })
    expect(zoomOut).toBeEnabled()

    fireEvent.click(zoomOut)
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_left' }))
    expect(image).toHaveStyle({ transform: 'scale(1) rotate(270deg) scaleX(1) scaleY(1)' })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.flip_horizontal' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.flip_vertical' }))
    expect(image).toHaveStyle({ transform: 'scale(1.25) rotate(90deg) scaleX(-1) scaleY(-1)' })

    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.reset' }))
    expect(image).toHaveStyle({ transform: 'scale(1) rotate(0deg) scaleX(1) scaleY(1)' })
  })

  it('resets image state when the file path changes', async () => {
    const { rerender } = render(<FilePreview filePath={'/tmp/photos/first.jpg' as FilePath} />)
    const firstImage = await screen.findByRole('img', { name: 'first.jpg' })
    fireEvent.load(firstImage)
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.rotate_right' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'preview.flip_horizontal' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(firstImage).toHaveStyle({ transform: 'scale(1.25) rotate(90deg) scaleX(-1) scaleY(1)' })

    rerender(<FilePreview filePath={'/tmp/photos/second.jpg' as FilePath} />)

    const secondImage = await screen.findByRole('img', { name: 'second.jpg' })
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(secondImage).toHaveStyle({ transform: 'scale(1) rotate(0deg) scaleX(1) scaleY(1)' })
  })

  it('rebuilds the image preview when the refresh key changes', async () => {
    const filePath = '/tmp/photos/refresh.jpg' as FilePath
    const { rerender } = render(<FilePreview filePath={filePath} refreshKey={0} />)
    const firstImage = await screen.findByRole('img', { name: 'refresh.jpg' })
    fireEvent.load(firstImage)

    rerender(<FilePreview filePath={filePath} refreshKey={1} />)

    const refreshedImage = await screen.findByRole('img', { name: 'refresh.jpg' })
    expect(refreshedImage).not.toBe(firstImage)
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
  })
})
