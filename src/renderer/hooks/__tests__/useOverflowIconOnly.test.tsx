import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useOverflowIconOnly } from '../useOverflowIconOnly'

const originalResizeObserver = globalThis.ResizeObserver

function ToolbarProbe() {
  const { iconOnly, containerRef } = useOverflowIconOnly()

  return <div ref={containerRef} data-testid="toolbar" data-icon-only={String(iconOnly)} />
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
})
