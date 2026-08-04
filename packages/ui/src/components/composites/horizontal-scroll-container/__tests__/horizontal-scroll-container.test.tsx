// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HorizontalScrollContainer from '../index'

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  target?: Element
}

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverInstances: ResizeObserverMockInstance[] = []

function setElementSize(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number; scrollLeft: number }) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: sizes.clientWidth },
    scrollLeft: { configurable: true, writable: true, value: sizes.scrollLeft },
    scrollWidth: { configurable: true, value: sizes.scrollWidth }
  })
}

function triggerResizeObserver() {
  const instance = resizeObserverInstances[0]
  if (!instance?.target) throw new Error('Expected the scroll element to be observed')

  act(() => {
    instance.callback([{ target: instance.target } as ResizeObserverEntry], {} as ResizeObserver)
  })
}

describe('HorizontalScrollContainer', () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance: ResizeObserverMockInstance = { callback }
      resizeObserverInstances.push(instance)
      return {
        observe: vi.fn((target: Element) => {
          instance.target = target
        }),
        disconnect: vi.fn()
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('provides keyboard-accessible controls in both directions', () => {
    render(
      <HorizontalScrollContainer scrollDistance={120}>
        <span>One</span>
        <span>Two</span>
      </HorizontalScrollContainer>
    )
    const content = screen.getByText('Two').closest('[data-scrolling]') as HTMLElement
    const scrollBy = vi.fn()
    Object.defineProperty(content, 'scrollBy', { configurable: true, value: scrollBy })
    setElementSize(content, { clientWidth: 100, scrollLeft: 0, scrollWidth: 300 })

    triggerResizeObserver()

    expect(screen.queryByRole('button', { name: '←' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '→' }))
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: 120 })

    content.scrollLeft = 200
    fireEvent.scroll(content)

    expect(screen.queryByRole('button', { name: '→' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '←' }))
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: -120 })
  })
})
