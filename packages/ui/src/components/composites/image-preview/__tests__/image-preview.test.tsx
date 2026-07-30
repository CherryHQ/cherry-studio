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
    const { result } = renderHook(() => useImagePreviewTransform({ maxZoom: 2, minZoom: 1, zoomStep: 0.5 }))

    expect(result.current.transform).toEqual({
      flipX: false,
      flipY: false,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      zoom: 1
    })

    act(() => result.current.zoomOut())
    expect(result.current.transform.zoom).toBe(1)

    act(() => {
      result.current.zoomIn()
      result.current.zoomIn()
      result.current.zoomIn()
    })
    expect(result.current.transform.zoom).toBe(2)

    act(() => {
      result.current.rotateLeft()
      result.current.flipHorizontal()
      result.current.flipVertical()
    })
    expect(result.current.transform).toMatchObject({ flipX: true, flipY: true, rotation: 270 })

    act(() => result.current.reset())
    expect(result.current.transform).toEqual({
      flipX: false,
      flipY: false,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      zoom: 1
    })
  })

  it('updates transform through a clamped patch API', () => {
    const { result } = renderHook(() => useImagePreviewTransform({ maxZoom: 2, minZoom: 1 }))

    act(() => result.current.update({ offsetX: 12, rotation: 450, zoom: -10 }))

    expect(result.current.transform).toMatchObject({ offsetX: 12, rotation: 90, zoom: 1 })
    expect(result.current.canZoomIn).toBe(true)
    expect(result.current.canZoomOut).toBe(false)
  })

  it('validates transform bounds at hook entry', () => {
    expect(() => renderHook(() => useImagePreviewTransform({ maxZoom: 1, minZoom: 2 }))).toThrow('minZoom <= maxZoom')
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

    expect(screen.getByAltText('One')).toHaveAttribute('src', ITEMS[0].src)

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)

    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(screen.getByAltText('One')).toHaveAttribute('src', ITEMS[0].src)
  })

  it('renders all view transform controls', () => {
    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />)

    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
        .filter((label) => label !== LABELS.previous && label !== LABELS.next && label !== LABELS.close)
    ).toEqual([
      LABELS.zoomOut,
      LABELS.zoomIn,
      LABELS.rotateLeft,
      LABELS.rotateRight,
      LABELS.flipHorizontal,
      LABELS.flipVertical,
      LABELS.reset
    ])
  })

  it('uses a plain close icon and disables preview motion', () => {
    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />)

    const closeButton = screen.getByRole('button', { name: LABELS.close })
    expect(closeButton).toHaveClass('rounded-none', 'bg-transparent', 'shadow-none', 'transition-none')
    expect(closeButton).not.toHaveClass('rounded-full')
    expect(screen.getByTestId('image-preview-dialog')).toHaveClass('data-[state=open]:animate-none')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      'data-[state=closed]:animate-none',
      'data-[state=open]:animate-none'
    )
    expect(screen.getByAltText('One')).not.toHaveClass('transition-transform')
  })

  it('reveals the image only after its fitted geometry is ready', () => {
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })

    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />)

    const image = screen.getByAltText('One')
    expect(image).toHaveStyle({ visibility: 'hidden' })

    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 1200 },
      naturalWidth: { configurable: true, value: 1600 }
    })
    fireEvent.load(image)

    expect(image).toHaveStyle({
      height: '1200px',
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(0.5) scaleX(1) scaleY(1)',
      visibility: 'visible',
      width: '1600px'
    })

    getBoundingClientRect.mockRestore()
  })

  it('runs injected toolbar actions with the active item', async () => {
    const onSelect = vi.fn()

    render(
      <ImagePreviewDialog
        open
        items={ITEMS}
        labels={LABELS}
        onOpenChange={vi.fn()}
        toolbarActions={[{ id: 'open-external', label: 'Open externally', onSelect }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0], expect.objectContaining({ index: 0 }))
  })

  it('uses the viewport backdrop to close the dialog', () => {
    const onOpenChange = vi.fn()

    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByTestId('image-preview-viewport'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('zooms from the viewport and resets from the icon control', () => {
    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />)

    const viewport = screen.getByTestId('image-preview-viewport')
    const image = screen.getByAltText('One')
    fireEvent.wheel(viewport, { clientX: 0, clientY: 0, deltaY: -120 })

    expect(image).not.toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1) scaleX(1) scaleY(1)'
    })

    fireEvent.click(screen.getByRole('button', { name: LABELS.reset }))
    expect(image).toHaveStyle({
      transform: 'translate3d(0px, 0px, 0) rotate(0deg) scale(1) scaleX(1) scaleY(1)'
    })
  })

  it('stops navigation at the first and last image', () => {
    render(<ImagePreviewDialog open items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: LABELS.previous })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: LABELS.next }))
    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)
    expect(screen.getByRole('button', { name: LABELS.next })).toBeDisabled()
  })

  it('clamps active index when the items list shrinks', () => {
    const { rerender } = render(
      <ImagePreviewDialog open defaultActiveIndex={1} items={ITEMS} labels={LABELS} onOpenChange={vi.fn()} />
    )

    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)

    rerender(
      <ImagePreviewDialog open defaultActiveIndex={1} items={[ITEMS[0]]} labels={LABELS} onOpenChange={vi.fn()} />
    )

    expect(screen.getByAltText('One')).toHaveAttribute('src', ITEMS[0].src)
  })
})

describe('ImagePreviewTrigger', () => {
  it('opens a multi-image dialog from a thumbnail', () => {
    render(<ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={ITEMS} dialogProps={{ labels: LABELS }} />)

    fireEvent.click(screen.getByRole('img', { name: 'Open preview' }))

    expect(screen.getByAltText('One')).toHaveAttribute('src', ITEMS[0].src)

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)
  })

  it('keeps the active image when parent rerenders with inline items', () => {
    const { rerender } = render(
      <ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={[...ITEMS]} dialogProps={{ labels: LABELS }} />
    )

    fireEvent.click(screen.getByRole('img', { name: 'Open preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)

    rerender(
      <ImagePreviewTrigger alt="Open preview" item={ITEMS[0]} items={[...ITEMS]} dialogProps={{ labels: LABELS }} />
    )

    expect(screen.getByAltText('Two')).toHaveAttribute('src', ITEMS[1].src)
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
      transform: { flipX: false, flipY: false, offsetX: 0, offsetY: 0, rotation: 0, zoom: 1 }
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
