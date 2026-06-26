import type { FileMetadata } from '@renderer/types/file'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    getFileUrl: (file: FileMetadata) => `https://files.test/${file.id}.png`
  }
}))

const { default: Artboard } = await import('../Artboard')

const makeFile = (id: string): FileMetadata =>
  ({
    id,
    name: `${id}.png`,
    origin_name: `${id}.png`,
    path: `/tmp/${id}.png`,
    size: 100,
    ext: '.png',
    type: 'image',
    created_at: '2026-01-01T00:00:00.000Z',
    count: 1
  }) as FileMetadata

const makePainting = (): PaintingData =>
  ({
    id: 'painting-1',
    providerId: 'openai',
    mode: 'generate',
    prompt: '',
    files: [makeFile('image-1'), makeFile('image-2')]
  }) as PaintingData

const firePointer = (element: Element, type: string, init: Record<string, number>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })

  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value })
  }

  fireEvent(element, event)
}

describe('Artboard', () => {
  beforeAll(() => {
    HTMLElement.prototype.setPointerCapture ??= vi.fn()
    HTMLElement.prototype.releasePointerCapture ??= vi.fn()
    HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => true)
  })

  it('resets image transform when switching generated images', () => {
    render(<Artboard painting={makePainting()} isLoading={false} onCancel={vi.fn()} />)

    const image = document.querySelector('img') as HTMLImageElement

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.rotate_right' }))
    firePointer(image, 'pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    firePointer(image, 'pointermove', { clientX: 35, clientY: 45, pointerId: 1 })

    expect(image.style.transform).toBe('translate(25px, 35px) scale(1.25) rotate(90deg)')

    fireEvent.click(screen.getByRole('button', { name: 'preview.next' }))

    expect(image).toHaveAttribute('src', 'https://files.test/image-2.png')
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1) rotate(0deg)')
  })
})
