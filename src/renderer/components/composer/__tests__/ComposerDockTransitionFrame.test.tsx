import { useChatBottomOverlayInset } from '@renderer/components/chat/layout/ChatViewportInsetContext'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerDockTransitionFrame from '../ComposerDockTransitionFrame'

function rect(top: number, bottom: number, left = 0, right = 1020): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function InsetProbe() {
  const insets = useChatBottomOverlayInset()
  return (
    <>
      <div data-testid="content-bottom-padding">{String(insets?.contentBottomPadding)}</div>
      <div data-testid="scroller-bottom-margin">{String(insets?.scrollerBottomMargin)}</div>
    </>
  )
}

describe('ComposerDockTransitionFrame', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(
      this: HTMLElement
    ) {
      if (this.hasAttribute('data-composer-inputbar')) {
        return rect(620, 820)
      }
      if (this.hasAttribute('data-composer-viewport-inset-target')) {
        return rect(640, 840)
      }
      if (this.hasAttribute('data-composer-dock-surface')) {
        return rect(600, 820)
      }
      if (this.hasAttribute('data-message-virtual-list-scroller')) {
        return rect(0, 900, 8, 1008)
      }

      return rect(0, 900)
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
      if (this.hasAttribute('data-message-virtual-list-scroller')) return 988
      return 1020
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('separates message content padding from scroll container bottom margin', async () => {
    render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('236')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('80')
    })
  })

  it('keeps the last good insets while the composer measures as a zero rect', async () => {
    const { rerender } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('80')
    })

    // A mid-swap composer (lazy chunk still loading behind Suspense) is hidden
    // and measures as a zero rect. Insets must hold instead of collapsing the
    // message list with a full-height bottom margin.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(
      this: HTMLElement
    ) {
      if (this.hasAttribute('data-composer-inputbar')) {
        return rect(0, 0, 0, 0)
      }
      if (this.hasAttribute('data-composer-dock-surface')) {
        return rect(600, 820)
      }
      return rect(0, 900)
    })
    rerender(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={
          <div>
            <div data-composer-inputbar="" />
          </div>
        }
        mainVisible
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('236')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('80')
    })
  })

  it('uses the generic composer viewport inset target when no inputbar is rendered', async () => {
    render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-viewport-inset-target="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('256')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('60')
    })
  })

  it('aligns composer width to the message scroller viewport', async () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={
          <>
            <InsetProbe />
            <div data-message-virtual-list-scroller="" />
          </>
        }
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      const dockLayer = container.querySelector<HTMLElement>('[data-composer-dock-layer]')
      expect(dockLayer).toHaveStyle({ paddingInlineStart: '8px', paddingInlineEnd: '24px' })
    })
  })

  it('lifts the composer dock layer above a full-area overlay only when elevated', () => {
    const baseProps = {
      placement: 'docked' as const,
      main: <InsetProbe />,
      composer: <div data-composer-inputbar="" />,
      mainVisible: true
    }
    const { container, rerender } = render(<ComposerDockTransitionFrame {...baseProps} />)
    expect(container.querySelector('[data-composer-dock-layer]')).toHaveClass('z-10')

    rerender(<ComposerDockTransitionFrame {...baseProps} composerElevated />)
    expect(container.querySelector('[data-composer-dock-layer]')).toHaveClass('z-50')
  })

  it('marks the composer surface when moving from home to docked placement', () => {
    const baseProps = {
      main: <InsetProbe />,
      composer: <div data-composer-inputbar="" />,
      mainVisible: true
    }
    const { container, rerender } = render(<ComposerDockTransitionFrame {...baseProps} placement="home" />)

    expect(container.querySelector('[data-composer-dock-surface]')).not.toHaveAttribute('data-composer-dock-motion')

    rerender(<ComposerDockTransitionFrame {...baseProps} placement="docked" />)

    const surface = container.querySelector('[data-composer-dock-surface]')
    expect(surface).toHaveAttribute('data-composer-dock-motion', 'home-to-docked')
    expect(surface).toHaveClass('animation-chat-composer-dock-down')
  })
})
