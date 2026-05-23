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
    expect(result.current.transform).toMatchObject({ flipX: true, flipY: true, rotate: 270 })

    act(() => result.current.reset())
    expect(result.current.transform).toEqual({ flipX: false, flipY: false, rotate: 0, scale: 1 })
  })

  it('updates transform through a clamped patch API', () => {
    const { result } = renderHook(() => useImagePreviewTransform({ maxScale: 2, minScale: 1 }))

    act(() => result.current.update({ rotate: 450, scale: -10 }))

    expect(result.current.transform).toMatchObject({ rotate: 90, scale: 1 })
    expect(result.current.canZoomIn).toBe(true)
    expect(result.current.canZoomOut).toBe(false)
  })

  it('validates transform bounds at hook entry', () => {
    expect(() => renderHook(() => useImagePreviewTransform({ maxScale: 1, minScale: 2 }))).toThrow(
      'minScale <= maxScale'
    )
    expect(() => renderHook(() => useImagePreviewTransform({ zoomStep: 0 }))).toThrow('zoomStep > 0')
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

  it('runs toolbar actions with the active item', async () => {
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

    await act(async () => {
      await Promise.resolve()
    })

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0], expect.objectContaining({ index: 0 }))
  })

  it('reports rejected toolbar actions', async () => {
    const error = new Error('copy failed')
    const onActionError = vi.fn()

    render(
      <ImagePreviewDialog
        open
        items={ITEMS}
        labels={LABELS}
        onActionError={onActionError}
        onOpenChange={vi.fn()}
        toolbarActions={[{ id: 'copy', label: 'Copy image', onSelect: () => Promise.reject(error) }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(onActionError).toHaveBeenCalledWith(error, expect.objectContaining({ id: 'copy' }), ITEMS[0])
  })

  it('uses pointer outside to close the dialog', async () => {
    const onOpenChange = vi.fn()

    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={onOpenChange} />)

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    fireEvent.pointerDown(document.body, { pointerType: 'mouse' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('navigates with arrow keys from the dialog content', () => {
    const onActiveIndexChange = vi.fn()

    render(
      <ImagePreviewDialog
        open
        items={ITEMS}
        labels={LABELS}
        onActiveIndexChange={onActiveIndexChange}
        onOpenChange={vi.fn()}
      />
    )

    fireEvent.keyDown(screen.getByTestId('image-preview-dialog'), { key: 'ArrowRight' })
    expect(onActiveIndexChange).toHaveBeenCalledWith(1)

    fireEvent.keyDown(screen.getByTestId('image-preview-dialog'), { key: 'ArrowLeft' })
    expect(onActiveIndexChange).toHaveBeenCalledWith(1)
  })

  it('clamps active index when the items list shrinks', () => {
    const { rerender } = render(
      <ImagePreviewDialog open defaultActiveIndex={1} items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />
    )

    expect(screen.getByRole('img', { name: 'Two' })).toHaveAttribute('src', ITEMS[1].src)

    rerender(
      <ImagePreviewDialog open defaultActiveIndex={1} items={[ITEMS[0]]} labels={LABELS} onOpenChange={vi.fn()} />
    )

    expect(screen.getByRole('img', { name: 'One' })).toHaveAttribute('src', ITEMS[0].src)
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
  it('renders and invokes injected context-menu actions', async () => {
    const onSelect = vi.fn()
    const context = {
      close: vi.fn(),
      index: 0,
      items: ITEMS,
      resetTransform: vi.fn(),
      transform: { flipX: false, flipY: false, rotate: 0, scale: 1 }
    }

    render(
      <ImagePreviewContextMenu
        item={ITEMS[0]}
        actions={[{ id: 'copy-src', label: 'Copy source', onSelect }]}
        context={context}>
        <img src={ITEMS[0].src} alt={ITEMS[0].alt} />
      </ImagePreviewContextMenu>
    )

    fireEvent.contextMenu(screen.getByRole('img', { name: 'One' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy source' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0], context)
  })
})
