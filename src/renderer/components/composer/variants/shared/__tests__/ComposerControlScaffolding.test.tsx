import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  ComposerActiveToolControls: () => null,
  ComposerToolMenu: () => null
}))

import { ComposerBelowControls, ComposerToolbarControls } from '../ComposerControlScaffolding'

const originalResizeObserver = globalThis.ResizeObserver

function ContextControls({ iconOnly, side }: { iconOnly: boolean; side: 'top' | 'bottom' }) {
  return <span data-testid={`${side}-controls`} data-icon-only={String(iconOnly)} />
}

describe('ComposerControlScaffolding', () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('reports compact controls when the top toolbar overflows', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)

    render(
      <ComposerToolbarControls
        showToolMenu={false}
        renderContextControls={({ iconOnly, side }) => <ContextControls iconOnly={iconOnly} side={side} />}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('top-controls')).toHaveAttribute('data-icon-only', 'true')
    })
  })

  it('keeps below-surface controls expanded when their content fits', () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)

    render(
      <ComposerBelowControls
        renderContextControls={({ iconOnly, side }) => <ContextControls iconOnly={iconOnly} side={side} />}
      />
    )

    expect(screen.getByTestId('bottom-controls')).toHaveAttribute('data-icon-only', 'false')
  })
})
