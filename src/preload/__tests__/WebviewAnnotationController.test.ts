import { WEBVIEW_ANNOTATION_LIMITS, type WebviewAnnotationState } from '@shared/types/webviewAnnotation'
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

const configure = (controller: WebviewAnnotationController) => {
  controller.handleCommand({ type: 'configure', locale, theme: 'light' })
  controller.handleCommand({ type: 'set_enabled', enabled: true })
}

const privateController = (controller: WebviewAnnotationController) =>
  controller as unknown as {
    annotationElements: Map<string, Element>
    editorAnnotationId: string | null
    editorElement: Element | null
    editorError: HTMLDivElement | null
    marqueeRect: unknown
    pendingRegion: unknown
    openEditor: (element: Element, annotationId?: string | null) => void
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

const pointerEvent = (type: string, clientX: number, clientY: number, pointerId = 1) =>
  Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY }), {
    pointerId
  })

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
  let states: WebviewAnnotationState[]

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    states = []
    controller = new WebviewAnnotationController((state) => states.push(state))
    configure(controller)
  })

  afterEach(() => {
    controller.dispose()
    document.body.replaceChildren()
    document.documentElement.querySelectorAll(':scope > div').forEach((element) => element.remove())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('intercepts page clicks and supports add, edit, and delete', () => {
    const pageClick = vi.fn()
    const pagePointerUp = vi.fn()
    const button = document.createElement('button')
    button.id = 'buy'
    button.addEventListener('click', pageClick)
    button.addEventListener('pointerup', pagePointerUp)
    document.body.appendChild(button)

    const pointerUp = new MouseEvent('pointerup', { bubbles: true, cancelable: true, composed: true })
    expect(button.dispatchEvent(pointerUp)).toBe(false)
    expect(pagePointerUp).not.toHaveBeenCalled()

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    expect(button.dispatchEvent(click)).toBe(false)
    expect(pageClick).not.toHaveBeenCalled()

    const internals = privateController(controller)
    internals.textarea.value = 'Use a clearer label'
    internals.saveEditor()
    expect(controller.getState().annotations).toHaveLength(1)
    expect(controller.getState().annotations[0].comment).toBe('Use a clearer label')

    const annotationId = controller.getState().annotations[0].id
    internals.openEditor(button, annotationId)
    internals.textarea.value = 'Updated note'
    internals.saveEditor()
    expect(controller.getState().annotations[0].comment).toBe('Updated note')

    internals.openEditor(button, annotationId)
    internals.deleteEditorAnnotation()
    expect(controller.getState().annotations).toEqual([])
  })

  it('saves with Ctrl+Enter and exits selection mode with Escape', () => {
    const button = document.createElement('button')
    button.id = 'keyboard-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor(button)
    internals.textarea.value = 'Keyboard note'

    internals.textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(controller.getState().annotations[0].comment).toBe('Keyboard note')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(controller.getState().enabled).toBe(false)
  })

  it('re-resolves an annotated element after DOM replacement', () => {
    const first = document.createElement('button')
    first.id = 'replaceable'
    document.body.appendChild(first)
    const internals = privateController(controller)
    internals.openEditor(first)
    internals.textarea.value = 'Keep tracking this'
    internals.saveEditor()
    const annotationId = controller.getState().annotations[0].id

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
    internals.openEditor(button)
    internals.textarea.value = 'Do not retain this element'
    internals.saveEditor()
    const annotationId = controller.getState().annotations[0].id

    button.remove()
    internals.updatePositions()

    expect(internals.annotationElements.has(annotationId)).toBe(false)
  })

  it('keeps the comment and explains when the selected element cannot be located', () => {
    const button = document.createElement('button')
    button.id = 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector)
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor(button)
    internals.textarea.value = 'Keep this draft'

    internals.saveEditor()

    expect(controller.getState().annotations).toEqual([])
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

    container.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 200, 200))
    container.dispatchEvent(pointerEvent('pointerup', 200, 200))

    // The click fired after a completed drag must not open the element editor.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    expect(container.dispatchEvent(click)).toBe(false)

    const internals = privateController(controller)
    internals.textarea.value = 'Untangle this overlap'
    internals.saveEditor()

    const annotation = controller.getState().annotations[0]
    expect(annotation.comment).toBe('Untangle this overlap')
    expect(annotation.element.selector).toBe('#canvas')
    expect(annotation.region?.rect).toEqual({ x: 10, y: 10, width: 190, height: 190 })
    expect(annotation.region?.elements.map((element) => element.selector)).toEqual([
      '#overlap-a',
      '#overlap-b',
      '#card'
    ])
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

    button.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 12, 13))
    button.dispatchEvent(pointerEvent('pointerup', 12, 13))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

    const internals = privateController(controller)
    expect(internals.pendingRegion).toBeNull()
    expect(internals.editorElement).toBe(button)

    internals.textarea.value = 'Element note'
    internals.saveEditor()
    expect(controller.getState().annotations[0].region).toBeUndefined()
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('cancels an in-progress marquee with Escape and stays enabled', () => {
    const container = document.createElement('div')
    container.id = 'escape-zone'
    document.body.appendChild(container)

    container.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 120, 120))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    const internals = privateController(controller)
    expect(internals.marqueeRect).toBeNull()
    expect(controller.getState().enabled).toBe(true)

    container.dispatchEvent(pointerEvent('pointerup', 120, 120))
    expect(internals.pendingRegion).toBeNull()
  })

  it('cancels an in-progress marquee when the pointer is cancelled', () => {
    const container = document.createElement('div')
    container.id = 'cancel-zone'
    document.body.appendChild(container)

    container.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 120, 120))
    document.dispatchEvent(pointerEvent('pointercancel', 120, 120))
    container.dispatchEvent(pointerEvent('pointerup', 120, 120))

    const internals = privateController(controller)
    expect(internals.marqueeRect).toBeNull()
    expect(internals.pendingRegion).toBeNull()
  })

  it('does not resume a marquee that reset interrupted', () => {
    const container = document.createElement('div')
    container.id = 'reset-zone'
    document.body.appendChild(container)

    container.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 120, 120))
    controller.handleCommand({ type: 'reset' })
    controller.handleCommand({ type: 'set_enabled', enabled: true })
    container.dispatchEvent(pointerEvent('pointerup', 120, 120))

    const internals = privateController(controller)
    expect(internals.marqueeRect).toBeNull()
    expect(internals.pendingRegion).toBeNull()
  })

  it('releases pointer capture when reset interrupts a marquee', () => {
    const container = document.createElement('div')
    container.id = 'captured-zone'
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(container, {
      setPointerCapture,
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    })
    document.body.appendChild(container)

    container.dispatchEvent(pointerEvent('pointerdown', 10, 10, 7))
    controller.handleCommand({ type: 'reset' })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it('enforces annotation and comment limits', () => {
    const internals = privateController(controller)
    for (let index = 0; index < WEBVIEW_ANNOTATION_LIMITS.annotations + 1; index++) {
      const element = document.createElement('button')
      element.id = `target-${index}`
      document.body.appendChild(element)
      internals.openEditor(element)
      if (!internals.editorElement) continue
      internals.textarea.value = 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment + 50)
      internals.saveEditor()
    }

    const state = controller.getState()
    expect(state.annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
    expect(state.annotations[0].comment).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.comment)
    expect(states.at(-1)?.annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
  })
})
