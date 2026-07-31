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

  it('measures only the active composer layer while the primary composer stays mounted', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(
      this: HTMLElement
    ) {
      if (this.hasAttribute('data-composer-viewport-inset-target')) {
        return this.closest('[data-testid="primary-layer"]') ? rect(620, 820) : rect(640, 840)
      }
      if (this.hasAttribute('data-composer-dock-surface')) {
        return rect(600, 820)
      }
      return rect(0, 900)
    })

    const composer = (overrideActive: boolean) => (
      <div data-composer-active-override={overrideActive ? 'tool-permission:approval-1' : undefined}>
        <div
          data-testid="primary-layer"
          data-composer-active-layer={overrideActive ? undefined : ''}
          aria-hidden={overrideActive || undefined}>
          <div data-composer-viewport-inset-target="" />
        </div>
        {overrideActive ? (
          <div data-testid="override-layer" data-composer-active-layer="">
            <div data-composer-viewport-inset-target="" />
          </div>
        ) : null}
      </div>
    )

    const view = render(
      <ComposerDockTransitionFrame placement="docked" main={<InsetProbe />} composer={composer(false)} mainVisible />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('236')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('80')
    })

    view.rerender(
      <ComposerDockTransitionFrame placement="docked" main={<InsetProbe />} composer={composer(true)} mainVisible />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('256')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('60')
    })
  })

  it('does not add a separate dock-side padding outside the composer layout', () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    expect(container.querySelector('[data-composer-dock-layer]')).not.toHaveClass('px-4')
  })

  it('keeps home placement bottom offset and removes it when the inputbar is expanded', () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="home"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
      />
    )

    const dockLayer = container.querySelector('[data-composer-dock-layer]')
    expect(dockLayer).toHaveClass('pb-[12vh]')
    expect(dockLayer).toHaveClass('has-[.inputbar-container.expanded]:pb-0')
    expect(dockLayer).not.toHaveClass('pt-(--navbar-height)')
  })

  it('keeps docked placement free of home placement offsets', () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    const dockLayer = container.querySelector('[data-composer-dock-layer]')
    expect(dockLayer).not.toHaveClass('pb-[12vh]')
    expect(dockLayer).not.toHaveClass('has-[.inputbar-container.expanded]:pb-0')
    expect(dockLayer).not.toHaveClass('pt-(--navbar-height)')
  })

  it('keeps the whole docked dock stack click-through', () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    // Pointer events are re-enabled by composer content roots, not the dock
    // stack — the layer is none and no full-width wrapper turns them back on.
    const dockLayer = container.querySelector('[data-composer-dock-layer]')
    expect(dockLayer).toHaveClass('pointer-events-none')
    expect(dockLayer?.querySelector('.pointer-events-auto')).toBeNull()
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
