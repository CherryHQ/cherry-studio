import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConversationTopBarPortal,
  ConversationTopBarPortalHost,
  ConversationTopBarPortalProvider,
  useConversationTopBarPortalLayout
} from '../ConversationTopBarPortal'

const originalResizeObserver = globalThis.ResizeObserver

function LayoutProbe() {
  const { iconOnly } = useConversationTopBarPortalLayout()
  return <span data-testid="layout-probe" data-icon-only={String(iconOnly)} />
}

describe('ConversationTopBarPortal', () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('uses compact hover surfaces for top-bar selector buttons', () => {
    const { container } = render(
      <ConversationTopBarPortalProvider>
        <ConversationTopBarPortalHost />
      </ConversationTopBarPortalProvider>
    )

    expect(container.querySelector('[data-conversation-topbar-controls]')).toHaveClass(
      '[&_button]:h-7',
      '[&_button]:px-1.5'
    )
  })

  it('switches portaled controls to icon-only mode when the host overflows', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
      return this.hasAttribute('data-conversation-topbar-controls') ? 100 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function scrollWidth(this: HTMLElement) {
      if (!this.hasAttribute('data-conversation-topbar-controls')) return 0
      return this.childElementCount > 0 ? 200 : 100
    })

    render(
      <ConversationTopBarPortalProvider>
        <ConversationTopBarPortalHost />
        <ConversationTopBarPortal>
          <LayoutProbe />
        </ConversationTopBarPortal>
      </ConversationTopBarPortalProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-icon-only', 'true')
    })
  })
})
