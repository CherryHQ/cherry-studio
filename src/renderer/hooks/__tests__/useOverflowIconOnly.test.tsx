import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useOverflowIconOnly } from '../useOverflowIconOnly'

const originalResizeObserver = globalThis.ResizeObserver

function ToolbarProbe({ pressed = false }: { pressed?: boolean }) {
  const { iconOnly, containerRef } = useOverflowIconOnly()

  return (
    <div ref={containerRef} data-testid="toolbar" data-icon-only={String(iconOnly)}>
      <button type="button" aria-pressed={pressed}>
        Tool
      </button>
    </div>
  )
}

describe('useOverflowIconOnly', () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('does not oscillate when compact mode changes the measured container width', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
      return this.getAttribute('data-icon-only') === 'true' ? 200 : 100
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function scrollWidth(this: HTMLElement) {
      return this.getAttribute('data-icon-only') === 'true' ? 80 : 200
    })

    render(<ToolbarProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('toolbar')).toHaveAttribute('data-icon-only', 'true')
    })
  })

  it('does not read layout on unrelated updates and still responds to a resize', () => {
    let onResize: ResizeObserverCallback | undefined
    globalThis.ResizeObserver = class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    const { rerender } = render(<ToolbarProbe />)
    const toolbar = screen.getByTestId('toolbar')
    expect(toolbar).toHaveAttribute('data-icon-only', 'false')

    clientWidth.mockClear()
    rerender(<ToolbarProbe pressed />)
    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument()
    expect(clientWidth).not.toHaveBeenCalled()

    clientWidth.mockReturnValue(150)
    act(() => onResize?.([], {} as ResizeObserver))
    expect(toolbar).toHaveAttribute('data-icon-only', 'true')
  })
})
