import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerContextProvider } from '../../../composer/ComposerContext'
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

  it('renders page-owned controls directly in the measured host', () => {
    render(
      <ConversationTopBarPortalProvider>
        <ConversationTopBarPortalHost>
          <span>page-owned controls</span>
        </ConversationTopBarPortalHost>
      </ConversationTopBarPortalProvider>
    )

    expect(screen.getByText('page-owned controls')).toBeInTheDocument()
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

  it('suppresses portaled composer controls while an override is active', () => {
    const view = render(
      <ComposerContextProvider value={{ overrides: [] }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.getByRole('button', { name: 'composer control' })).toBeInTheDocument()

    view.rerender(
      <ComposerContextProvider
        value={{
          overrides: [
            {
              id: 'tool-permission:approval-1',
              render: () => null
            }
          ]
        }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.queryByRole('button', { name: 'composer control' })).not.toBeInTheDocument()

    view.rerender(
      <ComposerContextProvider value={{ overrides: [] }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.getByRole('button', { name: 'composer control' })).toBeInTheDocument()
  })
})
