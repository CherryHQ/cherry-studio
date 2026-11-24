import { vi } from 'vitest'

class StubPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? ''
    this.isPrimary = init.isPrimary ?? false
  }
}

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

/** jsdom lacks the pointer, animation and scrolling APIs that @dnd-kit/dom calls during a drag. */
export function installDndDomStubs() {
  vi.stubGlobal('PointerEvent', StubPointerEvent)
  vi.stubGlobal('IntersectionObserver', StubObserver)
  vi.stubGlobal('ResizeObserver', StubObserver)
  window.PointerEvent = StubPointerEvent as unknown as typeof PointerEvent
  HTMLElement.prototype.setPointerCapture = () => {}
  window.matchMedia = () => ({ matches: false }) as MediaQueryList
  document.elementFromPoint = () => null
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.getAnimations = () => []
  Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} }) as unknown as Animation
  Document.prototype.getAnimations = () => []
}
