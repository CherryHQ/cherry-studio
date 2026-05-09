// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ImagePreviewContextMenu,
  ImagePreviewDialog,
  type ImagePreviewItem,
  ImagePreviewTrigger,
  useImagePreviewTransform
} from '../index'

const ITEMS: ImagePreviewItem[] = [
  { id: 'one', src: 'https://example.com/one.png', alt: 'One' },
  { id: 'two', src: 'https://example.com/two.png', alt: 'Two' }
]

const LABELS = {
  close: 'Close preview',
  flipHorizontal: 'Flip horizontal',
  flipVertical: 'Flip vertical',
  next: 'Next image',
  previous: 'Previous image',
  reset: 'Reset image',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out'
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useImagePreviewTransform', () => {
  it('clamps zoom and resets transform state', () => {
    const { result } = renderHook(() => useImagePreviewTransform({ maxScale: 2, minScale: 1, zoomStep: 0.5 }))

    expect(result.current.transform).toEqual({ flipX: false, flipY: false, rotate: 0, scale: 1 })

    act(() => result.current.zoomOut())
    expect(result.current.transform.scale).toBe(1)

    act(() => {
      result.current.zoomIn()
      result.current.zoomIn()
      result.current.zoomIn()
    })
    expect(result.current.transform.scale).toBe(2)

    act(() => {
      result.current.rotateLeft()
      result.current.flipHorizontal()
      result.current.flipVertical()
    })
    expect(result.current.transform).toMatchObject({ flipX: true, flipY: true, rotate: -90 })

    act(() => result.current.reset())
    expect(result.current.transform).toEqual({ flipX: false, flipY: false, rotate: 0, scale: 1 })
  })
})

describe('ImagePreviewDialog', () => {
  it('renders the active item and switches between images', () => {
    function Demo() {
      const [index, setIndex] = React.useState(0)
      return (
        <ImagePreviewDialog
          open
          items={ITEMS}
          activeIndex={index}
          onActiveIndexChange={setIndex}
          onOpenChange={vi.fn()}
          labels={LABELS}
        />
      )
    }

    render(<Demo />)

    expect(screen.getByRole('img', { name: 'One' })).toHaveAttribute('src', ITEMS[0].src)

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('img', { name: 'Two' })).toHaveAttribute('src', ITEMS[1].src)

    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(screen.getByRole('img', { name: 'One' })).toHaveAttribute('src', ITEMS[0].src)
  })

  it('runs toolbar actions with the active item', () => {
    const onSelect = vi.fn()

    render(
      <ImagePreviewDialog
        open
        items={ITEMS}
        labels={LABELS}
        onOpenChange={vi.fn()}
        toolbarActions={[{ id: 'copy', label: 'Copy image', onSelect }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }))

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0], expect.objectContaining({ index: 0 }))
  })

  it('closes when the backdrop is clicked', () => {
    const onOpenChange = vi.fn()

    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByTestId('image-preview-dialog'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ImagePreviewTrigger', () => {
  it('opens a multi-image dialog from a thumbnail', () => {
    render(<ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={ITEMS} dialogProps={{ labels: LABELS }} />)

    fireEvent.click(screen.getByRole('img', { name: 'Open preview' }))

    expect(screen.getByRole('img', { name: 'One' })).toHaveAttribute('src', ITEMS[0].src)

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByRole('img', { name: 'Two' })).toHaveAttribute('src', ITEMS[1].src)
  })

  it('keeps the active image when parent rerenders with inline items', () => {
    const { rerender } = render(
      <ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={[...ITEMS]} dialogProps={{ labels: LABELS }} />
    )

    fireEvent.click(screen.getByRole('img', { name: 'Open preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

    expect(screen.getByRole('img', { name: 'Two' })).toHaveAttribute('src', ITEMS[1].src)

    rerender(
      <ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={[...ITEMS]} dialogProps={{ labels: LABELS }} />
    )

    expect(screen.getByRole('img', { name: 'Two' })).toHaveAttribute('src', ITEMS[1].src)
  })
})

describe('ImagePreviewContextMenu', () => {
  it('renders and invokes injected context-menu actions', () => {
    const onSelect = vi.fn()

    render(
      <ImagePreviewContextMenu item={ITEMS[0]} actions={[{ id: 'copy-src', label: 'Copy source', onSelect }]}>
        <img src={ITEMS[0].src} alt={ITEMS[0].alt} />
      </ImagePreviewContextMenu>
    )

    fireEvent.contextMenu(screen.getByRole('img', { name: 'One' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy source' }))

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0], expect.objectContaining({ close: expect.any(Function) }))
  })
})
