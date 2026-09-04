import { WEBVIEW_ANNOTATION_LIMITS, type WebviewAnnotationGuestEvent } from '@shared/types/webviewAnnotation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildWebviewElementSelector,
  createWebviewElementLocator,
  resolveWebviewElementSelector,
  WebviewAnnotationController
} from '../WebviewAnnotationController'

const locale = {
  placeholder: 'Comment',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  elementUnavailable: "This element can't be annotated. Select a nearby element."
}

const sessionId = '00000000-0000-4000-8000-000000000001'
let requestSequence = 0

const configure = (controller: WebviewAnnotationController) => {
  controller.handleCommand({ type: 'start_session', sessionId })
  controller.handleCommand({ type: 'configure', sessionId, locale, theme: 'light' })
  controller.handleCommand({ type: 'set_enabled', sessionId, enabled: true })
}

const readSnapshot = (controller: WebviewAnnotationController, events: WebviewAnnotationGuestEvent[]) => {
  const requestId = `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, '0')}`
  controller.handleCommand({ type: 'request_snapshot', sessionId, requestId })
  const event = events.at(-1)
  if (event?.type !== 'snapshot_ready' || event.requestId !== requestId) throw new Error('Snapshot was not emitted')
  return event.annotations
}

const privateController = (controller: WebviewAnnotationController) =>
  controller as unknown as {
    annotationElements: Map<string, Element>
    editorAnnotationId: string | null
    editorElement: Element | null
    editorError: HTMLDivElement | null
    handlePointerCancel: (event: PointerEvent) => void
    handlePointerDown: (event: PointerEvent) => void
    handlePointerMove: (event: PointerEvent) => void
    handlePointerUp: (event: PointerEvent) => void
    highlightElement: Element | null
    marqueeOrigin: { x: number; y: number } | null
    marqueePointerCapture: { target: Element; pointerId: number } | null
    marqueePointerId: number | null
    marqueeRect: unknown
    overlayHost: HTMLDivElement | null
    pendingRegion: unknown
    pinLayer: HTMLDivElement | null
    openEditor: (
      request: { mode: 'create-element'; element: Element } | { mode: 'edit'; element: Element; annotationId: string }
    ) => void
    saveEditor: () => void
    deleteEditorAnnotation: () => void
    textarea: HTMLTextAreaElement
    updatePositions: () => void
  }

const mockRect = (element: Element, left: number, top: number, width: number, height: number) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect)
}

const trustedPointerEvent = (
  type: string,
  target: EventTarget,
  clientX: number,
  clientY: number,
  pointerId = 1,
  options: { button?: number; isPrimary?: boolean; path?: EventTarget[] } = {}
) =>
  ({
    button: options.button ?? 0,
    clientX,
    clientY,
    composedPath: () => options.path ?? [target, document.body, document.documentElement, document, window],
    isPrimary: options.isPrimary ?? true,
    isTrusted: true,
    pointerId,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    target,
    type
  }) as unknown as PointerEvent

describe('WebviewAnnotationController selectors', () => {
  it('prefers a unique id and resolves it', () => {
    const element = document.createElement('button')
    element.id = 'save:primary'
    document.body.appendChild(element)

    const selector = buildWebviewElementSelector(element)

    expect(selector).toBe('#save\\:primary')
    expect(resolveWebviewElementSelector(selector!)).toBe(element)
  })

  it('builds segmented selectors through open shadow roots', () => {
    const host = document.createElement('section')
    host.id = 'settings-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const element = document.createElement('button')
    element.setAttribute('data-testid', 'submit')
    shadowRoot.appendChild(element)
    document.body.appendChild(host)

    const selector = buildWebviewElementSelector(element)

    expect(selector).toBe('#settings-host >>> [data-testid="submit"]')
    expect(resolveWebviewElementSelector(selector!)).toBe(element)
  })

  it('does not read form values and caps page-derived summaries', () => {
    const input = document.createElement('input')
    input.id = 'secret'
    input.value = 'do-not-read'
    input.setAttribute('aria-label', 'a'.repeat(400))
    document.body.appendChild(input)

    const locator = createWebviewElementLocator(input)

    expect(locator?.text).toBeNull()
    expect(locator?.ariaLabel).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.ariaLabel)
    expect(JSON.stringify(locator)).not.toContain('do-not-read')
  })
})

describe('WebviewAnnotationController interactions', () => {
  let controller: WebviewAnnotationController
  let emissions: WebviewAnnotationGuestEvent[]

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    requestSequence = 0
    emissions = []
    controller = new WebviewAnnotationController((event) => emissions.push(event))
    configure(controller)
  })

  afterEach(() => {
    controller.dispose()
    document.body.replaceChildren()
    document.documentElement.querySelectorAll(':scope > div').forEach((element) => element.remove())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('leaves editable composed paths to the guest page', () => {
    const internals = privateController(controller)
    const editableTargets = ['input', 'textarea', 'select'].map((tagName) => document.createElement(tagName))
    const shadowHost = document.createElement('div')
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' })
    const contenteditable = document.createElement('div')
    contenteditable.setAttribute('contenteditable', '')
    const contenteditableChild = document.createElement('span')
    contenteditable.appendChild(contenteditableChild)
    shadowRoot.appendChild(contenteditable)
    document.body.append(...editableTargets, shadowHost)

    for (const target of editableTargets) {
      const pageClick = vi.fn()
      target.addEventListener('click', pageClick)
      const pointerDown = trustedPointerEvent('pointerdown', target, 10, 20)

      internals.handlePointerDown(pointerDown)
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true })
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })

      expect(pointerDown.preventDefault).not.toHaveBeenCalled()
      expect(target.dispatchEvent(mouseDown)).toBe(true)
      expect(target.dispatchEvent(click)).toBe(true)
      expect(pageClick).toHaveBeenCalledOnce()
      expect(internals.editorElement).toBeNull()
      expect(internals.marqueePointerId).toBeNull()
    }

    const shadowClick = vi.fn()
    contenteditableChild.addEventListener('click', shadowClick)
    const pointerDown = trustedPointerEvent('pointerdown', shadowHost, 30, 40, 2, {
      path: [
        contenteditableChild,
        contenteditable,
        shadowRoot,
        shadowHost,
        document.body,
        document.documentElement,
        document
      ]
    })
    internals.handlePointerDown(pointerDown)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })

    expect(pointerDown.preventDefault).not.toHaveBeenCalled()
    expect(contenteditableChild.dispatchEvent(click)).toBe(true)
    expect(shadowClick).toHaveBeenCalledOnce()
    expect(internals.editorElement).toBeNull()
    expect(internals.marqueePointerId).toBeNull()
  })

  it('does not treat the annotation overlay as a guest page target', () => {
    const internals = privateController(controller)
    const overlayHost = internals.overlayHost!
    const pointerDown = trustedPointerEvent('pointerdown', overlayHost, 10, 20, 3, {
      path: [overlayHost, document.documentElement, document]
    })

    internals.handlePointerDown(pointerDown)

    expect(pointerDown.preventDefault).not.toHaveBeenCalled()
    expect(internals.marqueePointerId).toBeNull()
  })

  it('ignores synthetic, secondary, and non-primary pointer starts', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const internals = privateController(controller)

    const synthetic = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 })
    expect(button.dispatchEvent(synthetic)).toBe(true)
    expect(synthetic.defaultPrevented).toBe(false)

    const secondary = trustedPointerEvent('pointerdown', button, 10, 20, 4, { button: 2 })
    internals.handlePointerDown(secondary)
    expect(secondary.preventDefault).not.toHaveBeenCalled()

    const nonPrimary = trustedPointerEvent('pointerdown', button, 10, 20, 5, { isPrimary: false })
    internals.handlePointerDown(nonPrimary)
    expect(nonPrimary.preventDefault).not.toHaveBeenCalled()
    expect(internals.marqueeOrigin).toBeNull()
    expect(internals.marqueePointerId).toBeNull()
  })

  it('tracks only the trusted pointer that started the active marquee', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const internals = privateController(controller)
    const pointerDown = trustedPointerEvent('pointerdown', button, 10, 20, 7)
    internals.handlePointerDown(pointerDown)

    const secondPointerDown = trustedPointerEvent('pointerdown', button, 30, 40, 8)
    internals.handlePointerDown(secondPointerDown)
    expect(secondPointerDown.preventDefault).not.toHaveBeenCalled()
    expect(internals.marqueePointerId).toBe(7)

    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 100, 120, 8))
    expect(internals.marqueeRect).toBeNull()
    internals.handlePointerUp(trustedPointerEvent('pointerup', document, 100, 120, 8))
    expect(internals.marqueePointerId).toBe(7)
    internals.handlePointerCancel(trustedPointerEvent('pointercancel', document, 100, 120, 8))
    expect(internals.marqueePointerId).toBe(7)

    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 100, 120, 7))
    expect(internals.marqueeRect).not.toBeNull()
    const untrustedUp = trustedPointerEvent('pointerup', document, 100, 120, 7)
    Object.defineProperty(untrustedUp, 'isTrusted', { value: false })
    internals.handlePointerUp(untrustedUp)
    expect(internals.marqueePointerId).toBe(7)
    const untrustedCancel = trustedPointerEvent('lostpointercapture', document, 100, 120, 7)
    Object.defineProperty(untrustedCancel, 'isTrusted', { value: false })
    internals.handlePointerCancel(untrustedCancel)
    expect(internals.marqueePointerId).toBe(7)

    internals.handlePointerCancel(trustedPointerEvent('pointercancel', document, 100, 120, 7))
    expect(internals.marqueeOrigin).toBeNull()
    expect(internals.marqueePointerId).toBeNull()
    expect(internals.marqueeRect).toBeNull()
  })

  it('updates hover only for trusted pointer events', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const internals = privateController(controller)
    const untrustedMove = trustedPointerEvent('pointermove', button, 10, 20)
    Object.defineProperty(untrustedMove, 'isTrusted', { value: false })

    internals.handlePointerMove(untrustedMove)
    expect(internals.highlightElement).toBeNull()

    internals.handlePointerMove(trustedPointerEvent('pointermove', button, 10, 20))
    expect(internals.highlightElement).toBe(button)
  })

  it('intercepts page clicks and supports add, edit, and delete', () => {
    const pageClick = vi.fn()
    const button = document.createElement('button')
    button.id = 'buy'
    button.addEventListener('click', pageClick)
    document.body.appendChild(button)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    expect(button.dispatchEvent(click)).toBe(false)
    expect(pageClick).not.toHaveBeenCalled()

    const internals = privateController(controller)
    internals.textarea.value = 'Use a clearer label'
    internals.saveEditor()
    expect(readSnapshot(controller, emissions)).toHaveLength(1)
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Use a clearer label')

    const annotationId = readSnapshot(controller, emissions)[0].id
    internals.openEditor({ mode: 'edit', element: button, annotationId })
    internals.textarea.value = 'Updated note'
    internals.saveEditor()
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Updated note')

    internals.openEditor({ mode: 'edit', element: button, annotationId })
    internals.deleteEditorAnnotation()
    expect(readSnapshot(controller, emissions)).toEqual([])
  })

  it('saves with Ctrl+Enter and exits selection mode with Escape', () => {
    const button = document.createElement('button')
    button.id = 'keyboard-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Keyboard note'

    internals.textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Keyboard note')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(controller.getState().enabled).toBe(false)
  })

  it('re-resolves an annotated element after DOM replacement', () => {
    const first = document.createElement('button')
    first.id = 'replaceable'
    document.body.appendChild(first)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: first })
    internals.textarea.value = 'Keep tracking this'
    internals.saveEditor()
    const annotationId = readSnapshot(controller, emissions)[0].id

    const replacement = document.createElement('button')
    replacement.id = 'replaceable'
    first.replaceWith(replacement)
    internals.updatePositions()

    expect(internals.annotationElements.get(annotationId)).toBe(replacement)
  })

  it('releases a disconnected annotated element when it cannot be resolved again', () => {
    const button = document.createElement('button')
    button.id = 'removed-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Do not retain this element'
    internals.saveEditor()
    const annotationId = readSnapshot(controller, emissions)[0].id

    button.remove()
    internals.updatePositions()

    expect(internals.annotationElements.has(annotationId)).toBe(false)
  })

  it('releases a disconnected region anchor', () => {
    const container = document.createElement('div')
    container.id = 'region-anchor'
    const overlapA = document.createElement('div')
    const overlapB = document.createElement('div')
    container.append(overlapA, overlapB)
    document.body.appendChild(container)
    mockRect(container, 0, 0, 400, 400)
    mockRect(overlapA, 20, 20, 100, 100)
    mockRect(overlapB, 80, 80, 100, 100)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 200, 200))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 200, 200))

    internals.textarea.value = 'Region note'
    internals.saveEditor()
    const annotationId = readSnapshot(controller, emissions)[0].id

    container.remove()
    internals.updatePositions()

    expect(internals.annotationElements.has(annotationId)).toBe(false)
  })

  it('repositions an annotation after direct text node updates', async () => {
    const button = document.createElement('button')
    button.id = 'live-label'
    const text = document.createTextNode('Before')
    button.appendChild(text)
    document.body.appendChild(button)
    let left = 10
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left,
          top: 20,
          right: left + 100,
          bottom: 60,
          width: 100,
          height: 40,
          x: left,
          y: 20,
          toJSON: () => ({})
        }) as DOMRect
    )
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Follow this label'
    internals.saveEditor()
    const pin = internals.pinLayer?.querySelector<HTMLElement>('button')

    await vi.waitFor(() => expect(pin?.style.left).toBe('10px'))

    left = 80
    text.data = 'After'

    await vi.waitFor(() => expect(pin?.style.left).toBe('80px'))
  })

  it('keeps the comment and explains when the selected element cannot be located', () => {
    const button = document.createElement('button')
    button.id = 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector)
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Keep this draft'

    internals.saveEditor()

    expect(readSnapshot(controller, emissions)).toEqual([])
    expect(internals.editorElement).toBe(button)
    expect(internals.textarea.value).toBe('Keep this draft')
    expect(internals.editorError?.getAttribute('role')).toBe('alert')
    expect(internals.editorError?.textContent).toBe(locale.elementUnavailable)
    expect(internals.editorError?.style.display).toBe('block')
  })

  it('marquee-selects overlapping elements into a region annotation', () => {
    const container = document.createElement('div')
    container.id = 'canvas'
    const overlapA = document.createElement('div')
    overlapA.id = 'overlap-a'
    const overlapB = document.createElement('div')
    overlapB.id = 'overlap-b'
    const card = document.createElement('div')
    card.id = 'card'
    const cardChild = document.createElement('span')
    cardChild.id = 'card-child'
    card.appendChild(cardChild)
    container.append(overlapA, overlapB, card)
    document.body.appendChild(container)

    // Container is mostly outside the box; the two overlapping siblings and the
    // card (plus its child) are inside. Dedupe must keep the card but drop its child.
    mockRect(container, 0, 0, 400, 400)
    mockRect(overlapA, 20, 20, 100, 100)
    mockRect(overlapB, 50, 50, 100, 100)
    mockRect(card, 130, 20, 60, 60)
    mockRect(cardChild, 135, 25, 20, 20)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 200, 200))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 200, 200))

    // The click fired after a completed drag must not open the element editor.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    expect(container.dispatchEvent(click)).toBe(false)

    internals.textarea.value = 'Untangle this overlap'
    internals.saveEditor()

    const annotation = readSnapshot(controller, emissions)[0]
    expect(annotation.comment).toBe('Untangle this overlap')
    expect(annotation.element.selector).toBe('#canvas')
    expect(annotation.region?.rect).toEqual({ x: 10, y: 10, width: 190, height: 190 })
    expect(annotation.region?.elements.map((element) => element.selector)).toEqual([
      '#overlap-a',
      '#overlap-b',
      '#card'
    ])
  })

  it('stores region geometry in page coordinates and projects pins back to the viewport', () => {
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(30)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(50)
    const container = document.createElement('div')
    container.id = 'scrolled-canvas'
    document.body.appendChild(container)
    mockRect(container, 0, 0, 400, 400)
    const internals = privateController(controller)

    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 20))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 110, 120))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 110, 120))
    internals.textarea.value = 'Keep this page region'
    internals.saveEditor()
    mockRect(container, 300, 400, 50, 60)
    internals.updatePositions()

    const annotation = readSnapshot(controller, emissions)[0]
    const pin = internals.pinLayer?.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
    expect(annotation.region?.rect).toEqual({ x: 40, y: 70, width: 100, height: 100 })
    expect(pin?.style.left).toBe('10px')
    expect(pin?.style.top).toBe('20px')
  })

  it('does not carry a pending region into a subsequent element annotation', () => {
    const regionTarget = document.createElement('div')
    regionTarget.id = 'region-target'
    const elementTarget = document.createElement('button')
    elementTarget.id = 'element-target'
    document.body.append(regionTarget, elementTarget)
    mockRect(regionTarget, 0, 0, 400, 400)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', regionTarget, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 200, 200))
    internals.handlePointerUp(trustedPointerEvent('pointerup', regionTarget, 200, 200))
    regionTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

    elementTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    internals.textarea.value = 'Annotate only this element'
    internals.saveEditor()

    expect(readSnapshot(controller, emissions)[0].element.selector).toBe('#element-target')
    expect(readSnapshot(controller, emissions)[0].region).toBeUndefined()
  })

  it('keeps sub-threshold drags on the single-element click flow', () => {
    const button = document.createElement('button')
    button.id = 'tiny-drag'
    const releasePointerCapture = vi.fn()
    Object.assign(button, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    })
    document.body.appendChild(button)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', button, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 12, 13))
    internals.handlePointerUp(trustedPointerEvent('pointerup', button, 12, 13))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

    expect(internals.pendingRegion).toBeNull()
    expect(internals.editorElement).toBe(button)

    internals.textarea.value = 'Element note'
    internals.saveEditor()
    expect(readSnapshot(controller, emissions)[0].region).toBeUndefined()
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('cancels an in-progress marquee with Escape and stays enabled', () => {
    const container = document.createElement('div')
    container.id = 'escape-zone'
    document.body.appendChild(container)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 120, 120))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(internals.marqueeRect).toBeNull()
    expect(controller.getState().enabled).toBe(true)

    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 120, 120))
    expect(internals.pendingRegion).toBeNull()
  })

  it('cancels an in-progress marquee when the pointer is cancelled', () => {
    const container = document.createElement('div')
    container.id = 'cancel-zone'
    document.body.appendChild(container)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 120, 120))
    internals.handlePointerCancel(trustedPointerEvent('pointercancel', document, 120, 120))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 120, 120))

    expect(internals.marqueeRect).toBeNull()
    expect(internals.pendingRegion).toBeNull()
  })

  it('does not resume a marquee that a new document session interrupted', () => {
    const container = document.createElement('div')
    container.id = 'reset-zone'
    document.body.appendChild(container)

    const internals = privateController(controller)
    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 120, 120))
    const nextSessionId = '00000000-0000-4000-8000-000000000002'
    controller.handleCommand({ type: 'start_session', sessionId: nextSessionId })
    controller.handleCommand({ type: 'configure', sessionId: nextSessionId, locale, theme: 'light' })
    controller.handleCommand({ type: 'set_enabled', sessionId: nextSessionId, enabled: true })
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 120, 120))

    expect(internals.marqueeRect).toBeNull()
    expect(internals.pendingRegion).toBeNull()
  })

  it('releases pointer capture when a new document session interrupts a marquee', () => {
    const container = document.createElement('div')
    container.id = 'captured-zone'
    const internals = privateController(controller)
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn(() => {
      expect(internals.marqueeOrigin).toBeNull()
      expect(internals.marqueePointerCapture).toBeNull()
      expect(internals.marqueePointerId).toBeNull()
      expect(internals.marqueeRect).toBeNull()
    })
    Object.assign(container, {
      setPointerCapture,
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    })
    document.body.appendChild(container)

    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10, 7))
    controller.handleCommand({ type: 'start_session', sessionId: '00000000-0000-4000-8000-000000000002' })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it('does not respond before a session starts', () => {
    const events: WebviewAnnotationGuestEvent[] = []
    const pending = new WebviewAnnotationController((event) => events.push(event))

    pending.handleCommand({ type: 'request_state' })

    expect(events).toEqual([])
    pending.dispose()
  })

  it('keeps committed annotations for the same session and clears them for a new one', () => {
    const button = document.createElement('button')
    button.id = 'stale-page-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Stale page note'
    internals.saveEditor()
    expect(readSnapshot(controller, emissions)).toHaveLength(1)

    emissions = []
    controller.handleCommand({ type: 'start_session', sessionId })
    expect(emissions).toEqual([{ type: 'state_changed', sessionId, enabled: true, count: 1 }])
    expect(readSnapshot(controller, emissions)).toHaveLength(1)

    emissions = []
    const nextSessionId = '00000000-0000-4000-8000-000000000002'
    controller.handleCommand({ type: 'start_session', sessionId: nextSessionId })
    controller.handleCommand({ type: 'request_state' })

    expect(controller.getState()).toEqual({ enabled: false, count: 0 })
    expect(emissions).toEqual([
      { type: 'state_changed', sessionId: nextSessionId, enabled: false, count: 0 },
      { type: 'state_changed', sessionId: nextSessionId, enabled: false, count: 0 }
    ])
  })

  it('ignores protected commands from a stale session and correlates snapshots', () => {
    emissions = []
    const staleSessionId = '00000000-0000-4000-8000-000000000099'
    const requestId = '00000000-0000-4000-8000-000000000010'

    controller.handleCommand({ type: 'set_enabled', sessionId: staleSessionId, enabled: false })
    controller.handleCommand({ type: 'clear', sessionId: staleSessionId })
    controller.handleCommand({ type: 'request_snapshot', sessionId: staleSessionId, requestId })

    expect(controller.getState().enabled).toBe(true)
    expect(emissions).toEqual([])

    controller.handleCommand({ type: 'request_snapshot', sessionId, requestId })
    expect(emissions).toEqual([{ type: 'snapshot_ready', sessionId, requestId, annotations: [] }])
  })

  it('deactivates selection and discards the draft without deleting committed annotations', () => {
    const button = document.createElement('button')
    button.id = 'committed'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    internals.textarea.value = 'Committed'
    internals.saveEditor()
    internals.openEditor({ mode: 'edit', element: button, annotationId: readSnapshot(controller, emissions)[0].id })
    internals.textarea.value = 'Unsaved draft'

    controller.handleCommand({ type: 'deactivate', sessionId })

    expect(controller.getState()).toEqual({ enabled: false, count: 1 })
    expect(internals.editorElement).toBeNull()
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Committed')
  })

  it('enforces annotation and comment limits', () => {
    const internals = privateController(controller)
    for (let index = 0; index < WEBVIEW_ANNOTATION_LIMITS.annotations + 1; index++) {
      const element = document.createElement('button')
      element.id = `target-${index}`
      document.body.appendChild(element)
      internals.openEditor({ mode: 'create-element', element })
      if (!internals.editorElement) continue
      internals.textarea.value = 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment + 50)
      internals.saveEditor()
    }

    const annotations = readSnapshot(controller, emissions)
    expect(annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
    expect(annotations[0].comment).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.comment)
    expect(controller.getState().count).toBe(WEBVIEW_ANNOTATION_LIMITS.annotations)
  })
})
