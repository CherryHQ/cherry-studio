import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useComposerBottomToolbarIconOnly } from '../useComposerBottomToolbarIconOnly'

const originalResizeObserver = globalThis.ResizeObserver

function ToolbarProbe() {
  const { iconOnly, toolbarRef } = useComposerBottomToolbarIconOnly()

  return <div ref={toolbarRef} data-testid="toolbar" data-icon-only={String(iconOnly)} />
}

describe('useComposerBottomToolbarIconOnly', () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('does not oscillate when compact mode changes the measured toolbar width', async () => {
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
