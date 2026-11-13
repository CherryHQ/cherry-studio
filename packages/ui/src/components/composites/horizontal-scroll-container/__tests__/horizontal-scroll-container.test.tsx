// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HorizontalScrollContainer from '../index'

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  targets: Element[]
}

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverInstances: ResizeObserverMockInstance[] = []
const accessibleLabels = {
  scrollLeftLabel: 'Scroll left',
  scrollRightLabel: 'Scroll right'
}

function setElementSize(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number; scrollLeft: number }) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: sizes.clientWidth },
    scrollLeft: { configurable: true, writable: true, value: sizes.scrollLeft },
    scrollWidth: { configurable: true, value: sizes.scrollWidth }
  })
  Object.defineProperty(element.parentElement, 'clientWidth', {
    configurable: true,
    value: sizes.clientWidth
  })
}

function triggerResizeObserver() {
  const instance = resizeObserverInstances[0]
  if (!instance || instance.targets.length === 0) {
    throw new Error('Expected the scroll container to be observed')
  }

  act(() => {
    instance.callback(
      instance.targets.map((target) => ({ target }) as ResizeObserverEntry),
      {} as ResizeObserver
    )
  })
}

function getScrollElement() {
  return screen.getByTestId('scroll-item').closest('[data-horizontal-scroll-viewport]') as HTMLElement
}

describe('HorizontalScrollContainer', () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0
    globalThis.ResizeObserver = vi.fn(function (callback: ResizeObserverCallback) {
      const instance: ResizeObserverMockInstance = { callback, targets: [] }
      resizeObserverInstances.push(instance)
      return {
        observe: vi.fn((target: Element) => instance.targets.push(target)),
        disconnect: vi.fn()
      } as unknown as ResizeObserver
    })
  })

  afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('shows only directions that can still scroll', () => {
    render(
      <HorizontalScrollContainer {...accessibleLabels}>
        <span data-testid="scroll-item">Item</span>
      </HorizontalScrollContainer>
    )
    const scrollElement = getScrollElement()
    setElementSize(scrollElement, { clientWidth: 100, scrollLeft: 0, scrollWidth: 300 })

    triggerResizeObserver()

    expect(screen.queryByRole('button', { name: 'Scroll left' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument()

    scrollElement.scrollLeft = 100
    fireEvent.scroll(scrollElement)

    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument()

    scrollElement.scrollLeft = 200
    fireEvent.scroll(scrollElement)

    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scroll right' })).not.toBeInTheDocument()
  })

  it('scrolls the requested distance using custom accessible labels', () => {
    render(
      <HorizontalScrollContainer scrollDistance={120} scrollLeftLabel="Previous items" scrollRightLabel="Next items">
        <span data-testid="scroll-item">Item</span>
      </HorizontalScrollContainer>
    )
    const scrollElement = getScrollElement()
    const scrollBy = vi.fn()
    Object.defineProperty(scrollElement, 'scrollBy', { configurable: true, value: scrollBy })
    setElementSize(scrollElement, { clientWidth: 100, scrollLeft: 100, scrollWidth: 300 })

    triggerResizeObserver()

    fireEvent.click(screen.getByRole('button', { name: 'Previous items' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next items' }))

    expect(scrollBy).toHaveBeenNthCalledWith(1, { behavior: 'smooth', left: -120 })
    expect(scrollBy).toHaveBeenNthCalledWith(2, { behavior: 'smooth', left: 120 })
  })

  it('recalculates available scroll directions after DOM content changes', async () => {
    render(
      <HorizontalScrollContainer {...accessibleLabels}>
        <span data-testid="scroll-item">One</span>
      </HorizontalScrollContainer>
    )
    const scrollElement = getScrollElement()
    setElementSize(scrollElement, { clientWidth: 100, scrollLeft: 0, scrollWidth: 100 })
    triggerResizeObserver()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    setElementSize(scrollElement, { clientWidth: 100, scrollLeft: 0, scrollWidth: 300 })
    act(() => {
      screen.getByTestId('scroll-item').textContent = 'Two'
    })

    expect(await screen.findByRole('button', { name: 'Scroll right' })).toBeInTheDocument()
  })
})
