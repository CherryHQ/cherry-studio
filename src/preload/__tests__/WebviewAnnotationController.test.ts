import {
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationState
} from '@shared/types/webview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildWebviewElementSelector,
  createWebviewElementLocator,
  resolveWebviewElementSelector,
  WebviewAnnotationController
} from '../WebviewAnnotationController'

const locale = { edit: 'Edit' }
const DOCUMENT_A_ID = '123e4567-e89b-42d3-a456-426614174001'
const DOCUMENT_B_ID = '123e4567-e89b-42d3-a456-426614174002'

const configureDocument = (controller: WebviewAnnotationController, documentId: string) => {
  controller.handleCommand({ type: 'configure', documentId, locale, theme: 'light' })
}

const configure = (controller: WebviewAnnotationController) => {
  configureDocument(controller, DOCUMENT_A_ID)
  controller.handleCommand({ type: 'set_enabled', enabled: true })
}

const eventDocumentId = (event: WebviewAnnotationGuestEvent) => event.documentId

const privateController = (controller: WebviewAnnotationController) =>
  controller as unknown as {
    annotationElements: Map<string, Element>
    marqueeRect: unknown
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

const pointerEvent = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY })

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

  it('captures non-default layout styles and caps their length', () => {
    const element = document.createElement('div')
    element.id = 'floating-card'
    element.style.cssText = 'position: absolute; z-index: 30; top: 12px; left: 24px; transform: translateX(10px);'
    document.body.appendChild(element)

    const locator = createWebviewElementLocator(element)

    expect(locator?.styles).toContain('position: absolute')
    expect(locator?.styles).toContain('z-index: 30')
    expect(locator?.styles).toContain('top: 12px')
    expect(locator?.styles).toContain('transform: translateX(10px)')
    expect(locator?.styles).not.toContain('float')
    expect(locator?.styles?.length).toBeLessThanOrEqual(WEBVIEW_ANNOTATION_LIMITS.styleText)
  })
})

describe('WebviewAnnotationController interactions', () => {
  let controller: WebviewAnnotationController
  let events: WebviewAnnotationGuestEvent[]

  const lastState = (): WebviewAnnotationState | undefined => {
    const event = [...events].reverse().find((item) => item.type === 'state_changed')
    return event?.type === 'state_changed' ? event.state : undefined
  }

  const lastSelection = () => {
    const event = [...events].reverse().find((item) => item.type === 'selection_pending')
    return event?.type === 'selection_pending' ? event.selection : undefined
  }

  const commit = (comment: string, id = crypto.randomUUID()) => {
    controller.handleCommand({ type: 'commit_pending', id, comment })
    return id
  }

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    events = []
    controller = new WebviewAnnotationController((event) => events.push(event))
    configure(controller)
  })

  afterEach(() => {
    controller.dispose()
    document.body.replaceChildren()
    document.documentElement.querySelectorAll(':scope > div').forEach((element) => element.remove())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('intercepts page clicks and runs add, edit, and delete through host commands', () => {
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

    expect(lastSelection()?.element.selector).toBe('#buy')

    const annotationId = commit('Use a clearer label')
    expect(controller.getState().annotations).toHaveLength(1)
    expect(controller.getState().annotations[0]).toMatchObject({ id: annotationId, comment: 'Use a clearer label' })

    controller.handleCommand({ type: 'update_annotation', id: annotationId, comment: 'Updated note' })
    expect(controller.getState().annotations[0].comment).toBe('Updated note')

    controller.handleCommand({ type: 'delete_annotation', id: annotationId })
    expect(controller.getState().annotations).toEqual([])
  })

  it('labels emitted state and selection events with the configured document', () => {
    const button = document.createElement('button')
    button.id = 'document-owned'
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    commit('Belongs to this document')

    expect(events.some((event) => event.type === 'selection_pending')).toBe(true)
    expect(events.some((event) => event.type === 'state_changed')).toBe(true)
    expect(events.every((event) => eventDocumentId(event) === DOCUMENT_A_ID)).toBe(true)
  })

  it('preserves annotations for same-document configuration and resets atomically for a new document', () => {
    const button = document.createElement('button')
    button.id = 'old-document'
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    commit('Old document annotation')

    configureDocument(controller, DOCUMENT_A_ID)
    expect(controller.getState().annotations).toHaveLength(1)

    configureDocument(controller, DOCUMENT_B_ID)
    expect(controller.getState()).toEqual({ enabled: false, annotations: [] })
    expect(events.at(-1)).toEqual({
      documentId: DOCUMENT_B_ID,
      type: 'state_changed',
      state: { enabled: false, annotations: [] }
    })
  })

  it('clears a pending selection with the first Escape and exits selection mode with the next', () => {
    const button = document.createElement('button')
    button.id = 'keyboard-target'
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    expect(lastSelection()?.element.selector).toBe('#keyboard-target')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(events.at(-1)?.type).toBe('selection_cleared')
    expect(controller.getState().enabled).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(controller.getState().enabled).toBe(false)
  })

  it('re-resolves an annotated element after DOM replacement', () => {
    const first = document.createElement('button')
    first.id = 'replaceable'
    document.body.appendChild(first)
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    const annotationId = commit('Keep tracking this')

    const internals = privateController(controller)
    const replacement = document.createElement('button')
    replacement.id = 'replaceable'
    first.replaceWith(replacement)
    internals.updatePositions()

    expect(internals.annotationElements.get(annotationId)).toBe(replacement)
  })

  it('enforces annotation and comment limits', () => {
    for (let index = 0; index < WEBVIEW_ANNOTATION_LIMITS.annotations + 1; index++) {
      const element = document.createElement('button')
      element.id = `target-${index}`
      document.body.appendChild(element)
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
      commit('x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment + 50))
    }

    const state = controller.getState()
    expect(state.annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
    expect(state.annotations[0].comment).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.comment)
    expect(lastState()?.annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
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

    // The click fired after a completed drag must not restart a selection.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
    expect(container.dispatchEvent(click)).toBe(false)

    const selection = lastSelection()
    expect(selection?.element.selector).toBe('#canvas')
    expect(selection?.region?.rect).toEqual({ x: 10, y: 10, width: 190, height: 190 })
    expect(selection?.anchor).toEqual({ x: 10, y: 10, width: 190, height: 190 })

    commit('Untangle this overlap')
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
    document.body.appendChild(button)

    button.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    document.dispatchEvent(pointerEvent('pointermove', 12, 13))
    button.dispatchEvent(pointerEvent('pointerup', 12, 13))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

    const selection = lastSelection()
    expect(selection?.element.selector).toBe('#tiny-drag')
    expect(selection?.region).toBeUndefined()

    commit('Element note')
    expect(controller.getState().annotations[0].region).toBeUndefined()
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
    expect(lastSelection()).toBeUndefined()
  })

  it('cancels a pending selection when the host sends cancel_pending', () => {
    const button = document.createElement('button')
    button.id = 'cancel-me'
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    expect(lastSelection()).toBeDefined()

    controller.handleCommand({ type: 'cancel_pending' })
    commit('Should not be saved')
    expect(controller.getState().annotations).toEqual([])
  })
})
