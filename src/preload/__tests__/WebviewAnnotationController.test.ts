// @vitest-environment jsdom

import {
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationGuestEventSchema
} from '@shared/types/webviewAnnotation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildWebviewElementSelector,
  createWebviewElementLocator,
  resolveWebviewElementSelector,
  WebviewAnnotationController
} from '../WebviewAnnotationController'

const locale = {
  edit: 'Edit'
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
    editorRequestId: string | null
    handleClick: (event: MouseEvent) => void
    handleWindowKeyDown: (event: KeyboardEvent) => void
    handlePointerCancel: (event: PointerEvent) => void
    handlePointerDown: (event: PointerEvent) => void
    handlePointerMove: (event: PointerEvent) => void
    handlePointerUp: (event: PointerEvent) => void
    highlightElement: Element | null
    iframeShields: Map<HTMLIFrameElement, HTMLDivElement>
    marqueeOrigin: { x: number; y: number } | null
    marqueePointerCapture: { target: Element; pointerId: number } | null
    marqueePointerId: number | null
    marqueeRect: unknown
    observedRoots: { has: (root: Document | ShadowRoot) => boolean }
    overlayHost: HTMLDivElement | null
    overlayRoot: ShadowRoot | null
    pendingRegion: unknown
    pinLayer: HTMLDivElement | null
    updateFrame: number | null
    openEditor: (
      request: { mode: 'create-element'; element: Element } | { mode: 'edit'; element: Element; annotationId: string }
    ) => void
    schedulePositionUpdate: () => void
    updatePositions: () => void
  }

const currentEditorRequest = (events: WebviewAnnotationGuestEvent[]) => {
  const event = events.findLast((candidate) => candidate.type === 'editor_requested')
  if (!event || event.type !== 'editor_requested') throw new Error('Editor request was not emitted')
  return event
}

const saveEditor = (
  controller: WebviewAnnotationController,
  events: WebviewAnnotationGuestEvent[],
  comment: string
) => {
  const request = currentEditorRequest(events)
  controller.handleCommand({ type: 'save_editor', sessionId, requestId: request.requestId, comment })
}

const deleteEditor = (controller: WebviewAnnotationController, events: WebviewAnnotationGuestEvent[]) => {
  const request = currentEditorRequest(events)
  controller.handleCommand({ type: 'delete_editor', sessionId, requestId: request.requestId })
}

const mockRect = (element: Element, left: number, top: number, width: number, height: number) => {
  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
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

const installFrameDriver = () => {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  const cancel = vi.fn((id: number) => callbacks.delete(id))
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    cancel,
    get pending() {
      return callbacks.size
    },
    runNext() {
      const entry = callbacks.entries().next().value
      if (!entry) throw new Error('No animation frame was scheduled')
      callbacks.delete(entry[0])
      entry[1](entry[0])
    }
  }
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

const trustedMouseEvent = (target: EventTarget, path?: EventTarget[], clientX = 0, clientY = 0) =>
  ({
    clientX,
    clientY,
    composedPath: () => path ?? [target, document.body, document.documentElement, document, window],
    isTrusted: true,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    target
  }) as unknown as MouseEvent

const trustedKeyboardEvent = (key: string, target: EventTarget = document, path?: EventTarget[]) =>
  ({
    composedPath: () => path ?? (target === document ? [document, window] : [target, document, window]),
    isTrusted: true,
    key,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    target
  }) as unknown as KeyboardEvent

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

  it('round-trips test attributes that contain the shadow selector separator', () => {
    const host = document.createElement('section')
    host.setAttribute('data-testid', 'settings >>> host')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const element = document.createElement('button')
    element.setAttribute('data-testid', 'save >>> button')
    shadowRoot.appendChild(element)
    document.body.appendChild(host)

    const selector = buildWebviewElementSelector(element)
    document.body.prepend(document.createElement('section'))
    shadowRoot.prepend(document.createElement('button'))

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

  it('omits text from editable elements and containers with editable descendants', () => {
    const contenteditable = document.createElement('div')
    contenteditable.id = 'draft'
    contenteditable.setAttribute('contenteditable', '')
    contenteditable.textContent = 'private contenteditable draft'
    contenteditable.innerText = 'private contenteditable draft'
    const roleTextbox = document.createElement('div')
    roleTextbox.id = 'role-textbox'
    roleTextbox.setAttribute('role', 'textbox')
    roleTextbox.textContent = 'private ARIA draft'
    roleTextbox.innerText = 'private ARIA draft'
    const container = document.createElement('section')
    container.id = 'editor-container'
    container.append('Public heading', contenteditable)
    container.innerText = 'Public heading private contenteditable draft'
    document.body.append(container, roleTextbox)

    expect(createWebviewElementLocator(contenteditable)?.text).toBeNull()
    expect(createWebviewElementLocator(roleTextbox)?.text).toBeNull()
    expect(createWebviewElementLocator(container)?.text).toBeNull()
  })

  it('omits text for design-mode documents, inherited contenteditable, and tokenized editable roles', () => {
    const previousDesignMode = document.designMode
    const designModeTarget = document.createElement('section')
    designModeTarget.id = 'design-mode-draft'
    designModeTarget.innerText = 'private design mode draft'
    document.body.appendChild(designModeTarget)

    try {
      document.designMode = 'on'
      expect(createWebviewElementLocator(designModeTarget)?.text).toBeNull()
    } finally {
      document.designMode = previousDesignMode
    }

    const editableParent = document.createElement('div')
    editableParent.setAttribute('contenteditable', 'true')
    const inheritedEditable = document.createElement('span')
    inheritedEditable.id = 'inherited-editable'
    inheritedEditable.innerText = 'private inherited draft'
    editableParent.appendChild(inheritedEditable)

    const tokenizedRole = document.createElement('div')
    tokenizedRole.id = 'tokenized-role'
    tokenizedRole.setAttribute('role', 'unknown textbox')
    tokenizedRole.innerText = 'private tokenized role draft'
    const container = document.createElement('section')
    container.id = 'tokenized-role-container'
    container.innerText = 'container private tokenized role draft'
    container.appendChild(tokenizedRole)
    document.body.append(editableParent, container)

    expect(createWebviewElementLocator(inheritedEditable)?.text).toBeNull()
    expect(createWebviewElementLocator(tokenizedRole)?.text).toBeNull()
    expect(createWebviewElementLocator(container)?.text).toBeNull()
  })
})

describe('WebviewAnnotationController interactions', () => {
  let controller: WebviewAnnotationController
  let emissions: WebviewAnnotationGuestEvent[]
  let notifyResize: (() => void) | undefined
  let observeResize: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    observeResize = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = () => callback([], this as unknown as ResizeObserver)
        }
        observe = observeResize
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    requestSequence = 0
    emissions = []
    controller = new WebviewAnnotationController((event) => emissions.push(event))
    configure(controller)
  })

  afterEach(() => {
    controller.dispose()
    document.body.replaceChildren()
    document.documentElement.querySelectorAll(':scope > div').forEach((element) => element.remove())
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('leaves editable composed paths to the guest page', () => {
    const internals = privateController(controller)
    const editableTargets = ['input', 'textarea', 'select'].map((tagName) => document.createElement(tagName))
    const ariaTextbox = document.createElement('div')
    ariaTextbox.setAttribute('role', 'unknown textbox')
    editableTargets.push(ariaTextbox)
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

    const designModeTarget = document.createElement('div')
    document.body.appendChild(designModeTarget)
    const designModePointerDown = trustedPointerEvent('pointerdown', designModeTarget, 50, 60, 3)
    const previousDesignMode = document.designMode
    try {
      document.designMode = 'on'
      internals.handlePointerDown(designModePointerDown)
    } finally {
      document.designMode = previousDesignMode
    }
    expect(designModePointerDown.preventDefault).not.toHaveBeenCalled()
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

  it('ignores synthetic click and Escape entry points', () => {
    const button = document.createElement('button')
    button.id = 'synthetic-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    const syntheticEscape = trustedKeyboardEvent('Escape')
    const syntheticClick = trustedMouseEvent(button)
    Object.defineProperty(syntheticEscape, 'isTrusted', { value: false })
    Object.defineProperty(syntheticClick, 'isTrusted', { value: false })

    controller.handleKeyDown(syntheticEscape)
    internals.handleClick(syntheticClick)

    expect(controller.getState().enabled).toBe(true)
    expect(internals.editorElement).toBeNull()
    expect(syntheticEscape.preventDefault).not.toHaveBeenCalled()
    expect(syntheticClick.preventDefault).not.toHaveBeenCalled()
  })

  it('intercepts page clicks and supports add, edit, and delete', () => {
    const pageClick = vi.fn()
    const button = document.createElement('button')
    button.id = 'buy'
    button.addEventListener('click', pageClick)
    document.body.appendChild(button)

    const internals = privateController(controller)
    const click = trustedMouseEvent(button)
    internals.handleClick(click)
    expect(click.preventDefault).toHaveBeenCalledOnce()
    expect(pageClick).not.toHaveBeenCalled()

    saveEditor(controller, emissions, 'Use a clearer label')
    expect(readSnapshot(controller, emissions)).toHaveLength(1)
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Use a clearer label')

    const annotationId = readSnapshot(controller, emissions)[0].id
    internals.openEditor({ mode: 'edit', element: button, annotationId })
    saveEditor(controller, emissions, 'Updated note')
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Updated note')

    internals.openEditor({ mode: 'edit', element: button, annotationId })
    deleteEditor(controller, emissions)
    expect(readSnapshot(controller, emissions)).toEqual([])
  })

  it('delegates draft text entry to the host and accepts only the correlated save', () => {
    const button = document.createElement('button')
    button.id = 'host-editor-target'
    document.body.appendChild(button)
    mockRect(button, 120, 240, 80, 32)
    const internals = privateController(controller)

    internals.openEditor({ mode: 'create-element', element: button })

    const editorRequest = currentEditorRequest(emissions)
    expect(editorRequest).toMatchObject({
      comment: '',
      canDelete: false,
      anchor: { x: 120, y: 240, width: 80, height: 32 }
    })
    expect('textarea' in internals).toBe(false)

    controller.handleCommand({
      type: 'save_editor',
      sessionId,
      requestId: editorRequest.requestId,
      comment: 'Host-owned draft'
    } as never)

    expect(readSnapshot(controller, emissions)[0].comment).toBe('Host-owned draft')
  })

  it('updates the correlated host editor anchor when its element moves', () => {
    const button = document.createElement('button')
    button.id = 'moving-editor-target'
    document.body.appendChild(button)
    let left = 40
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left,
          top: 90,
          right: left + 120,
          bottom: 130,
          width: 120,
          height: 40,
          x: left,
          y: 90,
          toJSON: () => ({})
        }) as DOMRect
    )
    const internals = privateController(controller)

    internals.openEditor({ mode: 'create-element', element: button })
    const requestId = currentEditorRequest(emissions).requestId
    left = 75
    internals.updatePositions()

    expect(emissions.at(-1)).toEqual({
      type: 'editor_anchor_changed',
      sessionId,
      requestId,
      anchor: { x: 75, y: 90, width: 120, height: 40 }
    })
  })

  it('creates schema-valid IDs when randomUUID is unavailable on insecure pages', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.set(Array.from({ length: bytes.length }, (_, index) => index + 1))
        return bytes
      })
    })
    const button = document.createElement('button')
    button.id = 'http-page-target'
    document.body.appendChild(button)

    privateController(controller).openEditor({ mode: 'create-element', element: button })
    const editorRequest = currentEditorRequest(emissions)
    expect(WebviewAnnotationGuestEventSchema.safeParse(editorRequest).success).toBe(true)

    saveEditor(controller, emissions, 'Works on HTTP')
    expect(readSnapshot(controller, emissions)[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('accepts a host save and exits selection mode with Escape', () => {
    const button = document.createElement('button')
    button.id = 'keyboard-target'
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    saveEditor(controller, emissions, 'Keyboard note')
    expect(readSnapshot(controller, emissions)[0].comment).toBe('Keyboard note')

    controller.handleKeyDown(trustedKeyboardEvent('Escape'))
    expect(controller.getState().enabled).toBe(false)
  })

  it('registers capture arbitration before hostile guest listeners and leaves disabled or editable input alone', () => {
    controller.dispose()
    const windowRegistrations = new Map<string, EventListener[]>()
    const documentRegistrations = new Map<string, EventListener[]>()
    const nativeAddEventListener = window.addEventListener.bind(window)
    const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click'].includes(type)) {
        const handlers = windowRegistrations.get(type) ?? []
        handlers.push(listener as EventListener)
        windowRegistrations.set(type, handlers)
        return
      }
      nativeAddEventListener(type, listener, options)
    })
    const nativeDocumentAddEventListener = document.addEventListener.bind(document)
    const documentAddEventListener = vi
      .spyOn(document, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'click') {
          const handlers = documentRegistrations.get(type) ?? []
          handlers.push(listener as EventListener)
          documentRegistrations.set(type, handlers)
          return
        }
        nativeDocumentAddEventListener(type, listener, options)
      })

    emissions = []
    controller = new WebviewAnnotationController((event) => emissions.push(event))
    configure(controller)
    const button = document.createElement('button')
    button.id = 'early-arbiter-target'
    const input = document.createElement('input')
    document.body.append(button, input)
    const hostileClick = vi.fn()
    const hostileDocumentClick = vi.fn()
    window.addEventListener('click', hostileClick, true)
    document.addEventListener('click', hostileDocumentClick, true)

    const dispatchCaptured = (type: string, event: Event) => {
      let stopped = false
      Object.assign(event, {
        stopImmediatePropagation: vi.fn(() => {
          stopped = true
        })
      })
      for (const listener of windowRegistrations.get(type) ?? []) {
        listener(event)
        if (stopped) break
      }
      if (!stopped) for (const listener of documentRegistrations.get(type) ?? []) listener(event)
    }

    dispatchCaptured('click', trustedMouseEvent(button))
    expect(privateController(controller).editorElement).toBe(button)
    expect(hostileClick).not.toHaveBeenCalled()
    expect(hostileDocumentClick).not.toHaveBeenCalled()

    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: false })
    hostileClick.mockClear()
    dispatchCaptured('click', trustedMouseEvent(button))
    expect(hostileClick).toHaveBeenCalledOnce()
    expect(hostileDocumentClick).toHaveBeenCalledOnce()

    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: true })
    hostileClick.mockClear()
    hostileDocumentClick.mockClear()
    dispatchCaptured('click', trustedMouseEvent(input))
    expect(hostileClick).toHaveBeenCalledOnce()
    expect(hostileDocumentClick).toHaveBeenCalledOnce()
    addEventListener.mockRestore()
    documentAddEventListener.mockRestore()
  })

  it('owns a marquee before hostile guest window capture listeners can cancel it', () => {
    controller.dispose()
    const registrations = new Map<string, EventListener[]>()
    const nativeAddEventListener = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (['pointerdown', 'pointermove', 'pointerup'].includes(type)) {
        const handlers = registrations.get(type) ?? []
        handlers.push(listener as EventListener)
        registrations.set(type, handlers)
        return
      }
      nativeAddEventListener(type, listener, options)
    })

    emissions = []
    controller = new WebviewAnnotationController((event) => emissions.push(event))
    configure(controller)
    const target = document.createElement('section')
    target.id = 'early-drag-target'
    Object.assign(target, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) })
    document.body.appendChild(target)
    mockRect(target, 0, 0, 300, 300)
    const hostilePointer = vi.fn()
    window.addEventListener('pointerdown', hostilePointer, true)
    window.addEventListener('pointermove', hostilePointer, true)
    window.addEventListener('pointerup', hostilePointer, true)

    const dispatchCaptured = (type: string, event: Event) => {
      let stopped = false
      Object.assign(event, {
        stopImmediatePropagation: vi.fn(() => {
          stopped = true
        })
      })
      for (const listener of registrations.get(type) ?? []) {
        listener(event)
        if (stopped) break
      }
    }

    dispatchCaptured('pointerdown', trustedPointerEvent('pointerdown', target, 10, 10))
    dispatchCaptured('pointermove', trustedPointerEvent('pointermove', target, 100, 100))
    dispatchCaptured('pointerup', trustedPointerEvent('pointerup', target, 100, 100))

    expect(hostilePointer).not.toHaveBeenCalled()
    expect(currentEditorRequest(emissions).anchor).toEqual({ x: 10, y: 10, width: 90, height: 90 })
  })

  it('maps full-viewport iframe shield input back to the iframe without entering its document', () => {
    const iframe = document.createElement('iframe')
    iframe.id = 'full-page-frame'
    document.body.appendChild(iframe)
    const iframeRect = mockRect(iframe, 0, 0, window.innerWidth, window.innerHeight)
    const contentDocumentRead = vi.fn()
    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      get: () => {
        contentDocumentRead()
        return null
      }
    })
    const internals = privateController(controller)

    internals.updatePositions()
    const shield = internals.iframeShields.get(iframe)
    expect(shield).toBeDefined()
    expect(shield?.style.cssText).toContain('width: 1024px')
    expect(shield?.style.cssText).toContain('height: 768px')
    iframeRect.mockReturnValue({
      left: 25,
      top: 35,
      right: 1049,
      bottom: 803,
      width: 1024,
      height: 768,
      x: 25,
      y: 35,
      toJSON: () => ({})
    } as DOMRect)
    internals.updatePositions()
    expect(shield?.style.left).toBe('25px')
    expect(shield?.style.top).toBe('35px')
    Object.assign(shield!, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false)
    })
    Object.defineProperty(internals.overlayRoot!, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => shield)
    })
    const shieldPath = [internals.overlayHost!, document.documentElement, document, window]

    internals.handleClick(trustedMouseEvent(internals.overlayHost!, shieldPath, 100, 100))
    expect(internals.editorElement).toBe(iframe)
    saveEditor(controller, emissions, 'Frame note')
    expect(readSnapshot(controller, emissions)[0].element.selector).toBe('#full-page-frame')

    internals.handlePointerDown(
      trustedPointerEvent('pointerdown', internals.overlayHost!, 10, 20, 4, { path: shieldPath })
    )
    internals.handlePointerMove(
      trustedPointerEvent('pointermove', internals.overlayHost!, 1010, 750, 4, { path: shieldPath })
    )
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => iframe) })
    internals.handlePointerUp(
      trustedPointerEvent('pointerup', internals.overlayHost!, 1010, 750, 4, { path: shieldPath })
    )
    saveEditor(controller, emissions, 'Frame region')

    const region = readSnapshot(controller, emissions).at(-1)
    expect(region?.element.selector).toBe('#full-page-frame')
    expect(region?.element.tagName).toBe('iframe')
    expect(region?.region?.elements.some((element) => element.selector === '#full-page-frame')).toBe(true)
    expect(contentDocumentRead).not.toHaveBeenCalled()
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
  })

  it('shields iframe input inside open shadow roots and cleans it up with the host', () => {
    const pageClick = vi.fn()
    const host = document.createElement('section')
    host.id = 'frame-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const iframe = document.createElement('iframe')
    iframe.id = 'shadow-frame'
    iframe.addEventListener('click', pageClick)
    shadowRoot.appendChild(iframe)
    document.body.appendChild(host)
    mockRect(iframe, 0, 0, window.innerWidth, window.innerHeight)
    const internals = privateController(controller)

    internals.updatePositions()
    const shield = internals.iframeShields.get(iframe)
    expect(shield).toBeDefined()
    Object.defineProperty(internals.overlayRoot!, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => shield)
    })
    const shieldPath = [internals.overlayHost!, document.documentElement, document, window]
    const click = trustedMouseEvent(internals.overlayHost!, shieldPath, 100, 100)

    internals.handleClick(click)

    expect(click.preventDefault).toHaveBeenCalledOnce()
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(pageClick).not.toHaveBeenCalled()
    expect(internals.editorElement).toBe(iframe)
    saveEditor(controller, emissions, 'Shadow frame note')
    expect(readSnapshot(controller, emissions)[0].element.selector).toBe('#frame-host >>> #shadow-frame')

    host.remove()
    internals.updatePositions()
    expect(internals.iframeShields.has(iframe)).toBe(false)
    expect(shield?.isConnected).toBe(false)
  })

  it('removes iframe input shields when annotation selection is disabled or deactivated', () => {
    const iframe = document.createElement('iframe')
    iframe.id = 'disposable-frame'
    document.body.appendChild(iframe)
    mockRect(iframe, 10, 20, 300, 200)
    const internals = privateController(controller)
    internals.updatePositions()
    const firstShield = internals.iframeShields.get(iframe)
    internals.openEditor({ mode: 'create-element', element: iframe })
    saveEditor(controller, emissions, 'Keep overlay mounted')

    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: false })
    expect(internals.iframeShields.size).toBe(0)
    expect(firstShield?.isConnected).toBe(false)
    expect(internals.overlayHost?.isConnected).toBe(true)

    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: true })
    internals.updatePositions()
    expect(internals.iframeShields.get(iframe)).toBeDefined()
    iframe.remove()
    internals.updatePositions()
    expect(internals.iframeShields.size).toBe(0)

    document.body.appendChild(iframe)
    internals.updatePositions()
    expect(internals.iframeShields.get(iframe)).toBeDefined()
    controller.handleCommand({ type: 'deactivate', sessionId })
    expect(internals.iframeShields.size).toBe(0)
  })

  it('keeps annotation pins interactive when closed-shadow events are retargeted to the overlay host', () => {
    const target = document.createElement('button')
    target.id = 'closed-shadow-pin-target'
    document.body.appendChild(target)
    mockRect(target, 100, 100, 80, 40)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: target })
    saveEditor(controller, emissions, 'Open from the pin')
    const annotationId = readSnapshot(controller, emissions)[0].id
    const pin = internals.pinLayer?.querySelector<HTMLButtonElement>(`[data-annotation-id="${annotationId}"]`)
    Object.defineProperty(internals.overlayRoot!, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => pin)
    })

    internals.handleClick(
      trustedMouseEvent(
        internals.overlayHost!,
        [internals.overlayHost!, document.documentElement, document, window],
        100,
        100
      )
    )

    expect(internals.editorAnnotationId).toBe(annotationId)
  })

  it('owns Escape from a focused closed-shadow pin before relaying keys to the host', () => {
    controller.dispose()
    const unhandledKeyDown = vi.fn()
    emissions = []
    controller = new WebviewAnnotationController((event) => emissions.push(event), unhandledKeyDown)
    configure(controller)
    const target = document.createElement('button')
    target.id = 'pin-escape-target'
    document.body.appendChild(target)
    mockRect(target, 100, 100, 80, 40)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: target })
    saveEditor(controller, emissions, 'Escape from the pin')
    const annotationId = readSnapshot(controller, emissions)[0].id
    const pin = internals.pinLayer?.querySelector<HTMLButtonElement>(`[data-annotation-id="${annotationId}"]`)
    Object.defineProperty(internals.overlayRoot!, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => pin)
    })
    internals.handleClick(
      trustedMouseEvent(
        internals.overlayHost!,
        [internals.overlayHost!, document.documentElement, document, window],
        100,
        100
      )
    )
    pin?.focus()
    expect(document.activeElement).toBe(internals.overlayHost)
    const closedShadowPath = [internals.overlayHost!, document.documentElement, document, window]

    const closeEditor = trustedKeyboardEvent('Escape', internals.overlayHost!, closedShadowPath)
    internals.handleWindowKeyDown(closeEditor)
    expect(closeEditor.preventDefault).toHaveBeenCalledOnce()
    expect(internals.editorElement).toBeNull()
    expect(controller.getState().enabled).toBe(true)

    const disable = trustedKeyboardEvent('Escape', internals.overlayHost!, closedShadowPath)
    internals.handleWindowKeyDown(disable)
    expect(disable.preventDefault).toHaveBeenCalledOnce()
    expect(controller.getState().enabled).toBe(false)
    expect(unhandledKeyDown).not.toHaveBeenCalled()
  })

  it('re-resolves an annotated element after DOM replacement', () => {
    const first = document.createElement('button')
    first.id = 'replaceable'
    document.body.appendChild(first)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: first })
    saveEditor(controller, emissions, 'Keep tracking this')
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
    saveEditor(controller, emissions, 'Do not retain this element')
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

    saveEditor(controller, emissions, 'Region note')
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
    saveEditor(controller, emissions, 'Follow this label')
    const pin = internals.pinLayer?.querySelector<HTMLElement>('button')

    await vi.waitFor(() => expect(pin?.style.left).toBe('10px'))

    left = 80
    text.data = 'After'

    await vi.waitFor(() => expect(pin?.style.left).toBe('80px'))
  })

  it('tracks reflow through the annotated element and its composed ancestors', async () => {
    const outerHost = document.createElement('section')
    outerHost.id = 'outer-host'
    const outerRoot = outerHost.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('article')
    innerHost.id = 'inner-host'
    const innerRoot = innerHost.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.id = 'resized-target'
    innerRoot.appendChild(button)
    outerRoot.appendChild(innerHost)
    document.body.appendChild(outerHost)
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
    saveEditor(controller, emissions, 'Follow composed reflow')

    expect(observeResize).toHaveBeenCalledWith(button)
    expect(observeResize).toHaveBeenCalledWith(innerHost)
    expect(observeResize).toHaveBeenCalledWith(outerHost)

    const pin = internals.pinLayer?.querySelector<HTMLElement>('button')
    await vi.waitFor(() => expect(pin?.style.left).toBe('10px'))
    left = 90
    notifyResize?.()
    await vi.waitFor(() => expect(pin?.style.left).toBe('90px'))
  })

  it('tracks animated annotation targets through their final frame and keeps iframe shields aligned', async () => {
    const ancestor = document.createElement('section')
    const button = document.createElement('button')
    button.id = 'animated-target'
    ancestor.appendChild(button)
    const iframe = document.createElement('iframe')
    document.body.append(ancestor, iframe)
    let left = 10
    let iframeLeft = 30
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
    vi.spyOn(iframe, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: iframeLeft,
          top: 40,
          right: iframeLeft + 200,
          bottom: 160,
          width: 200,
          height: 120,
          x: iframeLeft,
          y: 40,
          toJSON: () => ({})
        }) as DOMRect
    )
    let playState: AnimationPlayState = 'finished'
    let animationPending = false
    Object.defineProperty(ancestor, 'getAnimations', {
      configurable: true,
      value: vi.fn(() => [{ pending: animationPending, playState }])
    })
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    saveEditor(controller, emissions, 'Follow the animation')
    const annotation = readSnapshot(controller, emissions)[0]
    internals.openEditor({ mode: 'edit', element: button, annotationId: annotation.id })
    const requestId = currentEditorRequest(emissions).requestId
    await vi.waitFor(() => expect(internals.updateFrame).toBeNull())
    const frames = installFrameDriver()
    emissions = []
    playState = 'idle'
    animationPending = true

    internals.schedulePositionUpdate()
    frames.runNext()
    expect(frames.pending).toBe(1)

    animationPending = false
    playState = 'running'
    left = 75
    iframeLeft = 90
    frames.runNext()
    const pin = internals.pinLayer?.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
    expect(pin?.style.left).toBe('75px')
    expect(internals.iframeShields.get(iframe)?.style.left).toBe('90px')
    expect(emissions.at(-1)).toEqual({
      type: 'editor_anchor_changed',
      sessionId,
      requestId,
      anchor: { x: 75, y: 20, width: 100, height: 40 }
    })
    expect(frames.pending).toBe(1)

    playState = 'finished'
    left = 110
    iframeLeft = 120
    frames.runNext()
    expect(pin?.style.left).toBe('110px')
    expect(internals.iframeShields.get(iframe)?.style.left).toBe('120px')
    expect(frames.pending).toBe(0)
  })

  it.each([
    'animationstart',
    'animationend',
    'animationcancel',
    'transitionrun',
    'transitionstart',
    'transitionend',
    'transitioncancel'
  ])('refreshes a highlighted target for the %s lifecycle event', async (eventType) => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    let left = 10
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
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
    internals.highlightElement = target
    internals.updatePositions()
    await vi.waitFor(() => expect(internals.updateFrame).toBeNull())
    const frames = installFrameDriver()

    left = 80
    target.dispatchEvent(new Event(eventType, { bubbles: true }))
    expect(frames.pending).toBe(1)
    frames.runNext()

    expect(internals.overlayRoot?.querySelector<HTMLElement>('.highlight')?.style.left).toBe('80px')
    expect(frames.pending).toBe(0)
  })

  it('cancels animated target tracking when the empty overlay is disabled or disposed', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    let playState: AnimationPlayState = 'finished'
    Object.defineProperty(target, 'getAnimations', {
      configurable: true,
      value: vi.fn(() => [{ playState }])
    })
    const internals = privateController(controller)
    internals.highlightElement = target
    await vi.waitFor(() => expect(internals.updateFrame).toBeNull())
    const frames = installFrameDriver()
    playState = 'running'

    internals.schedulePositionUpdate()
    frames.runNext()
    expect(frames.pending).toBe(1)
    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: false })
    expect(frames.pending).toBe(0)
    expect(internals.overlayHost).toBeNull()

    controller.handleCommand({ type: 'set_enabled', sessionId, enabled: true })
    internals.highlightElement = target
    internals.schedulePositionUpdate()
    frames.runNext()
    expect(frames.pending).toBe(1)
    controller.dispose()
    expect(frames.pending).toBe(0)
    expect(frames.cancel).toHaveBeenCalled()
    target.dispatchEvent(new Event('animationstart', { bubbles: true }))
    expect(frames.pending).toBe(0)
  })

  it('stops observing a detached shadow root after its annotation is disconnected', async () => {
    const host = document.createElement('section')
    host.id = 'detached-observer-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.id = 'detached-observer-target'
    shadowRoot.appendChild(button)
    document.body.appendChild(host)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    saveEditor(controller, emissions, 'Release the old root')
    await vi.waitFor(() => expect(internals.updateFrame).toBeNull())

    host.remove()
    await vi.waitFor(() => expect(internals.updateFrame).toBeNull())
    internals.updatePositions()

    expect(internals.observedRoots.has(shadowRoot)).toBe(false)
  })

  it('keeps the comment and explains when the selected element cannot be located', () => {
    const button = document.createElement('button')
    button.id = 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector)
    document.body.appendChild(button)
    const internals = privateController(controller)
    internals.openEditor({ mode: 'create-element', element: button })
    saveEditor(controller, emissions, 'Keep this draft')

    const editorError = emissions.at(-1)
    expect(internals.editorElement).toBe(button)
    expect(editorError).toMatchObject({
      type: 'editor_error',
      requestId: internals.editorRequestId,
      reason: 'element_unavailable'
    })
    expect(readSnapshot(controller, emissions)).toEqual([])
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
    const click = trustedMouseEvent(container)
    internals.handleClick(click)
    expect(click.preventDefault).toHaveBeenCalledOnce()

    saveEditor(controller, emissions, 'Untangle this overlap')

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
    expect(currentEditorRequest(emissions)).toMatchObject({
      anchor: { x: 10, y: 20, width: 100, height: 100 }
    })
    saveEditor(controller, emissions, 'Keep this page region')
    mockRect(container, 300, 400, 50, 60)
    internals.updatePositions()

    const annotation = readSnapshot(controller, emissions)[0]
    const pin = internals.pinLayer?.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
    expect(annotation.region?.rect).toEqual({ x: 40, y: 70, width: 100, height: 100 })
    expect(pin?.style.left).toBe('10px')
    expect(pin?.style.top).toBe('20px')

    internals.openEditor({ mode: 'edit', element: container, annotationId: annotation.id })
    expect(currentEditorRequest(emissions)).toMatchObject({
      anchor: { x: 10, y: 20, width: 100, height: 100 }
    })
  })

  it('preserves page coordinates beyond the viewport anchor range in snapshot events', () => {
    const scrollX = 10_000_100
    const scrollY = 12_345_678
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(scrollX)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY)
    const container = document.createElement('div')
    container.id = 'large-scrolled-canvas'
    document.body.appendChild(container)
    mockRect(container, 0, 0, 400, 400)
    const internals = privateController(controller)

    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 20))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 110, 120))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 110, 120))
    saveEditor(controller, emissions, 'Keep this distant page region')

    const annotations = readSnapshot(controller, emissions)
    expect(annotations[0].region?.rect).toEqual({
      x: scrollX + 10,
      y: scrollY + 20,
      width: 100,
      height: 100
    })
    expect(
      WebviewAnnotationGuestEventSchema.safeParse({
        type: 'snapshot_ready',
        sessionId,
        requestId: '00000000-0000-4000-8000-000000000099',
        annotations
      }).success
    ).toBe(true)
  })

  it('stops building region locators after collecting the configured limit', () => {
    const container = document.createElement('div')
    container.id = 'dense-canvas'
    mockRect(container, 0, 0, 400, 400)
    const candidates = Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.regionElements + 2 }, (_, index) => {
      const candidate = document.createElement('button')
      candidate.id = index === 0 ? 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector) : `candidate-${index}`
      mockRect(candidate, 20, 20, 40, 40)
      container.appendChild(candidate)
      return candidate
    })
    document.body.appendChild(container)
    const untouchedLocatorTarget = candidates.at(-1)!
    const getRootNode = vi.spyOn(untouchedLocatorTarget, 'getRootNode')
    const internals = privateController(controller)

    internals.handlePointerDown(trustedPointerEvent('pointerdown', container, 10, 10))
    internals.handlePointerMove(trustedPointerEvent('pointermove', document, 200, 200))
    internals.handlePointerUp(trustedPointerEvent('pointerup', container, 200, 200))
    saveEditor(controller, emissions, 'Bound locator work')

    expect(readSnapshot(controller, emissions)[0].region?.elements.map((element) => element.selector)).toEqual(
      Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.regionElements }, (_, index) => `#candidate-${index + 1}`)
    )
    expect(getRootNode).not.toHaveBeenCalled()
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
    internals.handleClick(trustedMouseEvent(regionTarget))

    internals.handleClick(trustedMouseEvent(elementTarget))
    saveEditor(controller, emissions, 'Annotate only this element')

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
    internals.handleClick(trustedMouseEvent(button))

    expect(internals.pendingRegion).toBeNull()
    expect(internals.editorElement).toBe(button)

    saveEditor(controller, emissions, 'Element note')
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
    controller.handleKeyDown(trustedKeyboardEvent('Escape'))

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
    saveEditor(controller, emissions, 'Stale page note')
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

  it('attributes an interrupted editor request to the retired document session', () => {
    const button = document.createElement('button')
    button.id = 'retired-editor-target'
    document.body.appendChild(button)
    privateController(controller).openEditor({ mode: 'create-element', element: button })
    const requestId = currentEditorRequest(emissions).requestId
    emissions = []

    const nextSessionId = '00000000-0000-4000-8000-000000000002'
    controller.handleCommand({ type: 'start_session', sessionId: nextSessionId })

    expect(emissions).toEqual([
      { type: 'editor_closed', sessionId, requestId },
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
    saveEditor(controller, emissions, 'Committed')
    internals.openEditor({ mode: 'edit', element: button, annotationId: readSnapshot(controller, emissions)[0].id })

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
      saveEditor(controller, emissions, 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment + 50))
    }

    const annotations = readSnapshot(controller, emissions)
    expect(annotations).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.annotations)
    expect(annotations[0].comment).toHaveLength(WEBVIEW_ANNOTATION_LIMITS.comment)
    expect(controller.getState().count).toBe(WEBVIEW_ANNOTATION_LIMITS.annotations)
  })
})
