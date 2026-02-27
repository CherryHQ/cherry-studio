import { describe, expect, it, vi } from 'vitest'

import { findNearestScrollableAncestor, scrollElementIntoView } from '../dom'

const setElementSize = (
  el: HTMLElement,
  {
    clientHeight,
    scrollHeight,
    clientWidth = 0,
    scrollWidth = 0
  }: { clientHeight: number; scrollHeight: number; clientWidth?: number; scrollWidth?: number }
) => {
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
}

const setRectTopHeight = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      top,
      height,
      left: 0,
      right: 0,
      bottom: top + height,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({})
    }) as any
}

describe('utils/dom', () => {
  it('findNearestScrollableAncestor: 返回最近的可滚动祖先', () => {
    const root = document.createElement('div')
    root.style.overflowY = 'visible'
    setElementSize(root, { clientHeight: 100, scrollHeight: 100 })

    const scrollable = document.createElement('div')
    scrollable.style.overflowY = 'auto'
    setElementSize(scrollable, { clientHeight: 100, scrollHeight: 300 })

    const leaf = document.createElement('span')

    root.appendChild(scrollable)
    scrollable.appendChild(leaf)
    document.body.appendChild(root)

    expect(findNearestScrollableAncestor(leaf)).toBe(scrollable)
    document.body.removeChild(root)
  })

  it('findNearestScrollableAncestor: respect boundary', () => {
    const root = document.createElement('div')
    root.style.overflowY = 'auto'
    setElementSize(root, { clientHeight: 100, scrollHeight: 300 })

    const mid = document.createElement('div')
    mid.style.overflowY = 'visible'
    setElementSize(mid, { clientHeight: 100, scrollHeight: 100 })

    const leaf = document.createElement('span')

    root.appendChild(mid)
    mid.appendChild(leaf)
    document.body.appendChild(root)

    // boundary 设置为 mid，则不应越过 mid 去找到 root
    expect(findNearestScrollableAncestor(leaf, mid)).toBe(null)
    document.body.removeChild(root)
  })

  it('scrollElementIntoView: 传入容器 overflow 不可滚动时，回退到最近可滚动祖先', () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'visible'
    setElementSize(outer, { clientHeight: 100, scrollHeight: 300 })
    ;(outer as any).scrollTo = vi.fn()
    ;(outer as any).scrollBy = vi.fn()
    Object.defineProperty(outer, 'scrollTop', { value: 0, writable: true, configurable: true })

    const inner = document.createElement('div')
    inner.style.overflowY = 'auto'
    setElementSize(inner, { clientHeight: 100, scrollHeight: 300 })
    ;(inner as any).scrollBy = vi.fn()
    Object.defineProperty(inner, 'scrollTop', { value: 0, writable: true, configurable: true })

    const target = document.createElement('div')
    outer.appendChild(inner)
    inner.appendChild(target)
    document.body.appendChild(outer)

    setRectTopHeight(inner, 100, 100)
    setRectTopHeight(target, 150, 10)

    scrollElementIntoView(target, outer, 'auto')

    expect((outer as any).scrollBy).not.toHaveBeenCalled()
    expect((inner as any).scrollBy).toHaveBeenCalledOnce()
    document.body.removeChild(outer)
  })

  it('scrollElementIntoView: column-reverse 容器按反向 delta 滚动', () => {
    const container = document.createElement('div')
    container.style.overflowY = 'auto'
    container.style.display = 'flex'
    container.style.flexDirection = 'column-reverse'
    setElementSize(container, { clientHeight: 100, scrollHeight: 300 })
    ;(container as any).scrollBy = vi.fn()
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true })

    const target = document.createElement('div')
    container.appendChild(target)
    document.body.appendChild(container)

    // deltaY = elementCenter(55) - containerCenter(150) = -95
    // column-reverse 下应使用 -deltaY => +95
    setRectTopHeight(container, 100, 100)
    setRectTopHeight(target, 50, 10)

    scrollElementIntoView(target, container, 'auto')

    expect((container as any).scrollBy).toHaveBeenCalledWith({ top: 95, behavior: 'auto' })
    document.body.removeChild(container)
  })

  it('scrollElementIntoView: 未传容器时，优先滚动最近可滚动祖先', () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'visible'
    setElementSize(outer, { clientHeight: 100, scrollHeight: 100 })

    const inner = document.createElement('div')
    inner.style.overflowY = 'auto'
    setElementSize(inner, { clientHeight: 100, scrollHeight: 300 })
    ;(inner as any).scrollBy = vi.fn()
    Object.defineProperty(inner, 'scrollTop', { value: 0, writable: true, configurable: true })

    const target = document.createElement('div')
    outer.appendChild(inner)
    inner.appendChild(target)
    document.body.appendChild(outer)

    setRectTopHeight(inner, 100, 100)
    setRectTopHeight(target, 150, 10)

    scrollElementIntoView(target, null, 'auto')

    expect((inner as any).scrollBy).toHaveBeenCalledOnce()
    document.body.removeChild(outer)
  })
})
