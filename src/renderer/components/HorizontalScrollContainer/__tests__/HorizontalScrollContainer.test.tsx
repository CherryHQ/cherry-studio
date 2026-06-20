import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HorizontalScrollContainer from '..'

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  target?: Element
  disconnect: ReturnType<typeof vi.fn>
}

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverInstances: ResizeObserverMockInstance[] = []

function setElementSize(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth })
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth })
}

function triggerResizeObserver() {
  const instance = resizeObserverInstances[0]
  if (!instance?.target) {
    throw new Error('Expected HorizontalScrollContainer to observe the scroll element')
  }

  act(() => {
    instance.callback([{ target: instance.target } as ResizeObserverEntry], {} as ResizeObserver)
  })
}

describe('HorizontalScrollContainer', () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance: ResizeObserverMockInstance = {
        callback,
        disconnect: vi.fn(),
        target: undefined
      }

      resizeObserverInstances.push(instance)

      return {
        observe: vi.fn((target: Element) => {
          instance.target = target
        }),
        disconnect: instance.disconnect
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('renders the scroll button above the scroll content layer', () => {
    render(
      <HorizontalScrollContainer>
        <button type="button">copy</button>
        <span className="message-tokens">Tokens: 42</span>
      </HorizontalScrollContainer>
    )

    const content = screen.getByText('Tokens: 42').closest('[data-scrolling]') as HTMLElement
    setElementSize(content, { clientWidth: 100, scrollWidth: 300 })

    triggerResizeObserver()

    const scrollButton = document.querySelector('.scroll-end-button')

    expect(content).toHaveClass('relative', 'z-0')
    expect(scrollButton).toHaveClass('z-10')
  })

  it('keeps the scroll button interaction intact', () => {
    render(
      <HorizontalScrollContainer scrollDistance={180}>
        <button type="button">copy</button>
        <span>Tokens: 42</span>
      </HorizontalScrollContainer>
    )

    const content = screen.getByText('Tokens: 42').closest('[data-scrolling]') as HTMLElement
    const scrollBy = vi.fn()
    Object.defineProperty(content, 'scrollBy', { configurable: true, value: scrollBy })
    setElementSize(content, { clientWidth: 100, scrollWidth: 300 })

    triggerResizeObserver()
    fireEvent.click(document.querySelector('.scroll-end-button') as HTMLElement)

    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'smooth' })
  })
})
