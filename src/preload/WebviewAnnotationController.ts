import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnnotation,
  type WebviewAnnotationAnchorRect,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationRegion,
  type WebviewAnnotationTheme,
  type WebviewElementLocator,
  type WebviewRegionRect
} from '@shared/types/webviewAnnotation'
import { v4 as uuidv4 } from 'uuid'

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy'] as const
const SENSITIVE_EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])
const SENSITIVE_EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox'])
const MARQUEE_DRAG_THRESHOLD_PX = 5
/** An element counts as inside the marquee when this share of its area overlaps the box. */
const REGION_CONTAINMENT_RATIO = 0.6
// ponytail: flat visit cap instead of spatial pruning — absolutely positioned
// children can escape their parent's box, so subtree pruning would miss them.
const REGION_WALK_BUDGET = 5_000
const POSITION_MOTION_EVENTS = [
  'animationstart',
  'animationiteration',
  'animationend',
  'animationcancel',
  'transitionrun',
  'transitionstart',
  'transitionend',
  'transitioncancel'
] as const

const createGuestUuid = () => uuidv4({ random: crypto.getRandomValues(new Uint8Array(16)) })

const OVERLAY_CSS = `
  :host {
    color-scheme: light dark;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  .highlight {
    position: fixed;
    display: none;
    border: 2px solid var(--annotation-accent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--annotation-accent) 12%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--annotation-surface) 70%, transparent);
    pointer-events: none;
  }

  .marquee {
    position: fixed;
    display: none;
    border: 2px dashed var(--annotation-accent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--annotation-accent) 8%, transparent);
    pointer-events: none;
  }

  .iframe-shield-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .iframe-shield {
    position: fixed;
    background: transparent;
    pointer-events: auto;
  }

  .pin {
    position: fixed;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 2px solid var(--annotation-surface);
    border-radius: 999px;
    background: var(--annotation-accent);
    color: white;
    box-shadow: 0 2px 8px color-mix(in srgb, black 28%, transparent);
    cursor: pointer;
    font: 700 12px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
    transform: translate(-50%, -50%);
  }

  .pin:hover,
  .pin:focus-visible {
    transform: translate(-50%, -50%) scale(1.08);
    outline: 2px solid var(--annotation-focus);
    outline-offset: 2px;
  }

`

const cssEscape = (value: string) => {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  let escaped = ''
  for (const [index, character] of Array.from(value).entries()) {
    const codePoint = character.codePointAt(0) ?? 0
    const mustEscapeAsCodePoint =
      codePoint === 0 ||
      (codePoint >= 1 && codePoint <= 31) ||
      codePoint === 127 ||
      (index === 0 && codePoint >= 48 && codePoint <= 57) ||
      (index === 1 && codePoint >= 48 && codePoint <= 57 && value[0] === '-')

    if (mustEscapeAsCodePoint) {
      escaped += codePoint === 0 ? '\uFFFD' : `\\${codePoint.toString(16)} `
    } else if (
      codePoint >= 128 ||
      character === '-' ||
      character === '_' ||
      (codePoint >= 48 && codePoint <= 57) ||
      (codePoint >= 65 && codePoint <= 90) ||
      (codePoint >= 97 && codePoint <= 122)
    ) {
      escaped += character
    } else {
      escaped += `\\${character}`
    }
  }
  return escaped
}

const escapeAttributeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/>/g, '\\3e ')

const queryAll = (root: Document | ShadowRoot, selector: string): Element[] => {
  try {
    return Array.from(root.querySelectorAll(selector))
  } catch {
    return []
  }
}

const isUniqueSelector = (root: Document | ShadowRoot, selector: string, element: Element) => {
  const matches = queryAll(root, selector)
  return matches.length === 1 && matches[0] === element
}

const isStableClassName = (className: string) => {
  if (!className || className.length > 64 || !/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/.test(className)) return false
  return !/[a-f0-9]{8,}/i.test(className) && !/\d{6,}/.test(className)
}

const getElementIndex = (element: Element) => {
  let index = 1
  let sibling = element.previousElementSibling
  while (sibling) {
    if (sibling.tagName === element.tagName) index++
    sibling = sibling.previousElementSibling
  }
  return index
}

const selectorPart = (element: Element, includeIndex: boolean) => {
  const tagName = element.tagName.toLowerCase()
  const classes = Array.from(element.classList).filter(isStableClassName).slice(0, 3)
  const classSelector = classes.map((className) => `.${cssEscape(className)}`).join('')
  const index = includeIndex ? `:nth-of-type(${getElementIndex(element)})` : ''
  return `${tagName}${classSelector}${index}`
}

const buildSelectorInRoot = (element: Element, root: Document | ShadowRoot): string | null => {
  if (element.id) {
    const idSelector = `#${cssEscape(element.id)}`
    if (isUniqueSelector(root, idSelector, element)) return idSelector
  }

  for (const attribute of TEST_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const selector = `[${attribute}="${escapeAttributeValue(value)}"]`
    if (isUniqueSelector(root, selector, element)) return selector
  }

  const classSelector = selectorPart(element, false)
  if (isUniqueSelector(root, classSelector, element)) return classSelector

  const parts: string[] = []
  let current: Element | null = element
  while (current) {
    const partWithoutIndex = selectorPart(current, false)
    const part = queryAll(root, partWithoutIndex).length === 1 ? partWithoutIndex : selectorPart(current, true)
    parts.unshift(part)
    const candidate = parts.join(' > ')
    if (isUniqueSelector(root, candidate, element)) return candidate

    const parent = current.parentElement
    if (!parent || parent.getRootNode() !== root) break
    current = parent
  }

  return null
}

export function buildWebviewElementSelector(element: Element): string | null {
  const segments: string[] = []
  let currentElement = element

  while (true) {
    const root = currentElement.getRootNode()
    if (!(root instanceof Document || root instanceof ShadowRoot)) return null

    const segment = buildSelectorInRoot(currentElement, root)
    if (!segment) return null
    segments.unshift(segment)

    if (root instanceof Document) break
    currentElement = root.host
  }

  const selector = segments.join(WEBVIEW_SHADOW_SELECTOR_SEPARATOR)
  return selector.length <= WEBVIEW_ANNOTATION_LIMITS.selector ? selector : null
}

export function resolveWebviewElementSelector(selector: string): Element | null {
  const segments = selector.split(WEBVIEW_SHADOW_SELECTOR_SEPARATOR)
  let root: Document | ShadowRoot = document
  let current: Element | null = null

  for (const [index, segment] of segments.entries()) {
    try {
      current = root.querySelector(segment)
    } catch {
      return null
    }
    if (!current) return null

    if (index < segments.length - 1) {
      if (!current.shadowRoot) return null
      root = current.shadowRoot
    }
  }

  return current
}

const composedParent = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

const isSensitiveEditable = (element: Element) => {
  if ((element.ownerDocument.designMode ?? '').toLowerCase() === 'on') return true
  if (SENSITIVE_EDITABLE_TAGS.has(element.tagName)) return true
  if (element instanceof HTMLElement) {
    if (element.isContentEditable) return true
    const contentEditable = element.getAttribute('contenteditable')
    if (contentEditable !== null && contentEditable.toLowerCase() !== 'false') return true
  }
  return (element.getAttribute('role') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .some((role) => SENSITIVE_EDITABLE_ROLES.has(role))
}

const containsSensitiveEditableContent = (element: Element) => {
  for (let current: Element | null = element; current; current = composedParent(current)) {
    if (isSensitiveEditable(current)) return true
  }

  const pending = [element]
  let visited = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    if (++visited > REGION_WALK_BUDGET) return true
    if (isSensitiveEditable(current)) return true
    if (current.shadowRoot) pending.push(...Array.from(current.shadowRoot.children))
    pending.push(...Array.from(current.children))
  }
  return false
}

const summarizeText = (element: Element) => {
  if (containsSensitiveEditableContent(element)) return null
  const text = element instanceof HTMLElement ? element.innerText : element.textContent
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized ? normalized.slice(0, WEBVIEW_ANNOTATION_LIMITS.text) : null
}

export function createWebviewElementLocator(element: Element): WebviewElementLocator | null {
  const selector = buildWebviewElementSelector(element)
  if (!selector) return null

  const ariaLabel = element.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() || null
  const role = element.getAttribute('role')?.replace(/\s+/g, ' ').trim() || null

  return {
    selector,
    tagName: element.tagName.toLowerCase().slice(0, WEBVIEW_ANNOTATION_LIMITS.tagName),
    text: summarizeText(element),
    ariaLabel: ariaLabel?.slice(0, WEBVIEW_ANNOTATION_LIMITS.ariaLabel) ?? null,
    role: role?.slice(0, WEBVIEW_ANNOTATION_LIMITS.role) ?? null
  }
}

interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

const boundedAnchorCoord = (value: number, minimum: number) =>
  Math.min(
    WEBVIEW_ANNOTATION_LIMITS.anchorCoord,
    Math.max(minimum, Math.round(Number.isFinite(value) ? value : minimum))
  )

const toAnchorRect = (rect: ViewportRect): WebviewAnnotationAnchorRect => ({
  x: boundedAnchorCoord(rect.left, -WEBVIEW_ANNOTATION_LIMITS.anchorCoord),
  y: boundedAnchorCoord(rect.top, -WEBVIEW_ANNOTATION_LIMITS.anchorCoord),
  width: boundedAnchorCoord(rect.width, 1),
  height: boundedAnchorCoord(rect.height, 1)
})

const boundedPageCoord = (value: number) =>
  Math.min(
    WEBVIEW_ANNOTATION_LIMITS.regionPageCoord,
    Math.max(-WEBVIEW_ANNOTATION_LIMITS.regionPageCoord, Math.round(Number.isFinite(value) ? value : 0))
  )

const boundedRegionSize = (value: number) =>
  Math.min(WEBVIEW_ANNOTATION_LIMITS.regionSize, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)))

const toPageRegionRect = (rect: ViewportRect): WebviewRegionRect => ({
  x: boundedPageCoord(rect.left + window.scrollX),
  y: boundedPageCoord(rect.top + window.scrollY),
  width: boundedRegionSize(rect.width),
  height: boundedRegionSize(rect.height)
})

const anchorRectsEqual = (left: WebviewAnnotationAnchorRect | null, right: WebviewAnnotationAnchorRect) =>
  left?.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height

type EditorRequest =
  | { mode: 'create-element'; element: Element }
  | { mode: 'create-region'; element: Element; region: WebviewAnnotationRegion }
  | { mode: 'edit'; element: Element; annotationId: string }

const findCommonAncestor = (elements: readonly Element[]): Element | null => {
  if (elements.length === 0) return null
  const chain = new Set<Element>()
  for (let current: Element | null = elements[0]; current; current = composedParent(current)) chain.add(current)
  for (const element of elements.slice(1)) {
    let current: Element | null = element
    while (current && !chain.has(current)) current = composedParent(current)
    if (!current) return null
    // Trim the chain down to the shared suffix so later elements narrow it further.
    let drop = false
    for (const kept of chain) {
      if (kept === current) drop = true
      if (!drop) chain.delete(kept)
    }
  }
  return chain.values().next().value ?? null
}

type StateListener = (event: WebviewAnnotationGuestEvent) => void
type UnhandledKeyDownListener = (event: KeyboardEvent) => void

export class WebviewAnnotationController {
  private annotations: WebviewAnnotation[] = []
  private annotationElements = new Map<string, Element>()
  private configured = false
  private editorAnchor: WebviewAnnotationAnchorRect | null = null
  private editorAnnotationId: string | null = null
  private editorElement: Element | null = null
  private editorRegion: WebviewRegionRect | null = null
  private editorRequestId: string | null = null
  private enabled = false
  private highlightElement: Element | null = null
  private iframeShieldLayer: HTMLDivElement | null = null
  private iframeShields = new Map<HTMLIFrameElement, HTMLDivElement>()
  private shieldIframes = new Map<HTMLDivElement, HTMLIFrameElement>()
  private marquee: HTMLDivElement | null = null
  private marqueePointerCapture: { target: Element; pointerId: number } | null = null
  private marqueePointerId: number | null = null
  private marqueeOrigin: { x: number; y: number } | null = null
  private marqueeRect: ViewportRect | null = null
  private pendingRegion: WebviewAnnotationRegion | null = null
  private suppressNextClick = false
  private locale: WebviewAnnotationLocale | null = null
  private mutationObserver: MutationObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private resizeObservedElements = new Set<Element>()
  private sessionId: string | null = null
  private observedRoots = new Set<Document | ShadowRoot>()
  private overlayHost: HTMLDivElement | null = null
  private overlayRoot: ShadowRoot | null = null
  private highlight: HTMLDivElement | null = null
  private pinLayer: HTMLDivElement | null = null
  private theme: WebviewAnnotationTheme = 'light'
  private updateFrame: number | null = null

  constructor(
    private readonly onStateChange: StateListener,
    private readonly onUnhandledKeyDown?: UnhandledKeyDownListener
  ) {
    this.addInputArbiter()
  }

  handleCommand(command: WebviewAnnotationHostCommand) {
    if (command.type === 'start_session') {
      if (command.sessionId !== this.sessionId) {
        this.reset(false)
        this.sessionId = command.sessionId
        this.configured = false
      }
      this.emitState()
      return
    }
    if (command.type === 'request_state') {
      this.emitState()
      return
    }
    if (command.sessionId !== this.sessionId) return

    switch (command.type) {
      case 'configure':
        this.configured = true
        this.locale = command.locale
        this.theme = command.theme
        this.applyTheme()
        break
      case 'set_enabled':
        this.setEnabled(command.enabled)
        break
      case 'clear':
        this.clearAnnotations()
        break
      case 'deactivate':
        this.setEnabled(false)
        break
      case 'save_editor':
        this.saveEditor(command.requestId, command.comment)
        break
      case 'cancel_editor':
        if (command.requestId === this.editorRequestId) this.closeEditor()
        break
      case 'delete_editor':
        this.deleteEditorAnnotation(command.requestId)
        break
      case 'request_snapshot':
        this.onStateChange({
          type: 'snapshot_ready',
          sessionId: command.sessionId,
          requestId: command.requestId,
          annotations: structuredClone(this.annotations)
        })
        break
    }
  }

  getState() {
    return {
      enabled: this.enabled,
      count: this.annotations.length
    }
  }

  dispose() {
    this.enabled = false
    this.removeInputArbiter()
    this.cancelMarquee()
    this.stopPositionTracking()
    this.removeOverlay()
  }

  private setEnabled(enabled: boolean) {
    const nextEnabled = enabled && this.configured
    if (this.enabled === nextEnabled) {
      this.emitState()
      return
    }

    this.enabled = nextEnabled
    if (this.enabled) {
      this.ensureOverlay()
      this.startPositionTracking()
    } else {
      this.clearIframeShields()
      this.cancelMarquee()
      this.closeEditor()
      this.highlightElement = null
      this.schedulePositionUpdate()
      if (this.annotations.length === 0) {
        this.stopPositionTracking()
        this.removeOverlay()
      }
    }
    this.emitState()
  }

  private reset(emit = true) {
    this.clearAnnotations(false)
    this.enabled = false
    this.clearIframeShields()
    this.cancelMarquee()
    this.stopPositionTracking()
    this.removeOverlay()
    if (emit) this.emitState()
  }

  private clearAnnotations(emit = true) {
    this.annotations = []
    this.annotationElements.clear()
    this.closeEditor()
    this.renderPins()
    if (emit) this.emitState()
    if (!this.enabled) {
      this.stopPositionTracking()
      this.removeOverlay()
    }
  }

  private emitState() {
    if (!this.sessionId) return
    this.onStateChange({ type: 'state_changed', sessionId: this.sessionId, ...this.getState() })
  }

  private ensureOverlay() {
    if (this.overlayHost) {
      if (!this.overlayHost.isConnected) document.documentElement?.appendChild(this.overlayHost)
      return
    }

    const host = document.createElement('div')
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;pointer-events:none!important;contain:layout style size!important;'
    const shadowRoot = host.attachShadow({ mode: 'closed' })
    this.installStyles(shadowRoot)

    const highlight = document.createElement('div')
    highlight.className = 'highlight'
    const marquee = document.createElement('div')
    marquee.className = 'marquee'
    const iframeShieldLayer = document.createElement('div')
    iframeShieldLayer.className = 'iframe-shield-layer'
    const pinLayer = document.createElement('div')
    shadowRoot.append(iframeShieldLayer, highlight, marquee, pinLayer)
    document.documentElement?.appendChild(host)

    this.overlayHost = host
    this.overlayRoot = shadowRoot
    this.highlight = highlight
    this.marquee = marquee
    this.iframeShieldLayer = iframeShieldLayer
    this.pinLayer = pinLayer
    this.applyTheme()
    this.renderPins()
  }

  private installStyles(shadowRoot: ShadowRoot) {
    if ('adoptedStyleSheets' in shadowRoot && typeof CSSStyleSheet !== 'undefined') {
      try {
        const stylesheet = new CSSStyleSheet()
        stylesheet.replaceSync(OVERLAY_CSS)
        shadowRoot.adoptedStyleSheets = [stylesheet]
        return
      } catch {
        // Fall through to a regular style element for runtimes without constructable stylesheet support.
      }
    }

    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    shadowRoot.appendChild(style)
  }

  private applyTheme() {
    if (!this.overlayHost) return
    const dark = this.theme === 'dark'
    this.overlayHost.style.setProperty('--annotation-accent', dark ? '#818cf8' : '#4f46e5', 'important')
    this.overlayHost.style.setProperty('--annotation-focus', dark ? '#c7d2fe' : '#3730a3', 'important')
    this.overlayHost.style.setProperty('--annotation-surface', dark ? '#0f172a' : '#ffffff', 'important')
  }

  private removeOverlay() {
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame)
      this.updateFrame = null
    }
    this.clearIframeShields()
    this.overlayHost?.remove()
    this.overlayHost = null
    this.overlayRoot = null
    this.highlight = null
    this.marquee = null
    this.iframeShieldLayer = null
    this.pinLayer = null
  }

  private addInputArbiter() {
    window.addEventListener('pointermove', this.handlePointerMove, true)
    window.addEventListener('pointerdown', this.handlePointerDown, true)
    window.addEventListener('pointerup', this.handlePointerUp, true)
    window.addEventListener('pointercancel', this.handlePointerCancel, true)
    window.addEventListener('lostpointercapture', this.handlePointerCancel, true)
    window.addEventListener('mousedown', this.blockSelectionEvent, true)
    window.addEventListener('mouseup', this.blockSelectionEvent, true)
    window.addEventListener('click', this.handleClick, true)
    window.addEventListener('keydown', this.handleWindowKeyDown, true)
  }

  private removeInputArbiter() {
    window.removeEventListener('pointermove', this.handlePointerMove, true)
    window.removeEventListener('pointerdown', this.handlePointerDown, true)
    window.removeEventListener('pointerup', this.handlePointerUp, true)
    window.removeEventListener('pointercancel', this.handlePointerCancel, true)
    window.removeEventListener('lostpointercapture', this.handlePointerCancel, true)
    window.removeEventListener('mousedown', this.blockSelectionEvent, true)
    window.removeEventListener('mouseup', this.blockSelectionEvent, true)
    window.removeEventListener('click', this.handleClick, true)
    window.removeEventListener('keydown', this.handleWindowKeyDown, true)
  }

  private isOverlayEvent(event: Event) {
    return Boolean(this.overlayHost && event.composedPath().includes(this.overlayHost))
  }

  private overlayEventTarget(event: Event) {
    const point = event as Event & { clientX?: unknown; clientY?: unknown }
    if (
      !this.overlayRoot ||
      !this.isOverlayEvent(event) ||
      typeof point.clientX !== 'number' ||
      typeof point.clientY !== 'number'
    ) {
      return null
    }
    try {
      return this.overlayRoot.elementFromPoint(point.clientX, point.clientY)
    } catch {
      return null
    }
  }

  private overlayPin(event: Event) {
    const target = this.overlayEventTarget(event)
    return target instanceof Element ? target.closest<HTMLButtonElement>('.pin') : null
  }

  private blockOverlayPinEvent(event: Event) {
    if (!this.overlayPin(event)) return false
    event.stopImmediatePropagation()
    return true
  }

  private isEditablePath(event: Event) {
    return event.composedPath().some((target) => target instanceof Element && isSensitiveEditable(target))
  }

  private pageEventElement(event: Event): Element | null {
    if (this.isEditablePath(event)) return null
    const overlayTarget = this.overlayEventTarget(event)
    if (overlayTarget instanceof HTMLDivElement) {
      const iframe = this.shieldIframes.get(overlayTarget)
      if (iframe?.isConnected) return iframe
    }
    for (const target of event.composedPath()) {
      if (target instanceof HTMLDivElement) {
        const iframe = this.shieldIframes.get(target)
        if (iframe?.isConnected) return iframe
      }
    }
    if (this.isOverlayEvent(event)) return null
    for (const target of event.composedPath()) {
      if (target instanceof Element && target !== this.overlayHost) return target
    }
    return event.target instanceof Element && event.target !== this.overlayHost ? event.target : null
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.enabled || !event.isTrusted) return
    if (this.marqueePointerId === null && this.blockOverlayPinEvent(event)) return
    if (this.marqueePointerId !== null) {
      if (event.pointerId !== this.marqueePointerId || !this.marqueeOrigin) return
      const passedThreshold =
        Math.abs(event.clientX - this.marqueeOrigin.x) >= MARQUEE_DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - this.marqueeOrigin.y) >= MARQUEE_DRAG_THRESHOLD_PX
      if (this.marqueeRect || passedThreshold) {
        this.marqueeRect = {
          left: Math.min(this.marqueeOrigin.x, event.clientX),
          top: Math.min(this.marqueeOrigin.y, event.clientY),
          width: Math.abs(event.clientX - this.marqueeOrigin.x),
          height: Math.abs(event.clientY - this.marqueeOrigin.y)
        }
        this.highlightElement = null
        this.renderMarquee()
        this.schedulePositionUpdate()
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    const element = this.pageEventElement(event)
    if (!element) return
    this.highlightElement = element
    this.schedulePositionUpdate()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private blockSelectionEvent = (event: Event) => {
    if (this.enabled && event.isTrusted && this.blockOverlayPinEvent(event)) return
    if (!this.enabled || !event.isTrusted || !this.pageEventElement(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (!this.enabled || !event.isTrusted || !event.isPrimary || event.button !== 0 || this.marqueePointerId !== null) {
      return
    }
    if (this.blockOverlayPinEvent(event)) return
    const element = this.pageEventElement(event)
    if (!element) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.marqueePointerId = event.pointerId
    this.marqueeOrigin = { x: event.clientX, y: event.clientY }
    try {
      const eventTarget = event.composedPath().find((target): target is Element => target instanceof Element)
      const pointerCaptureTarget =
        (element instanceof HTMLIFrameElement ? this.iframeShields.get(element) : null) ?? eventTarget ?? element
      pointerCaptureTarget.setPointerCapture(event.pointerId)
      this.marqueePointerCapture = { target: pointerCaptureTarget, pointerId: event.pointerId }
    } catch {
      // Window-level listeners still handle runtimes without pointer capture.
    }
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.enabled || !event.isTrusted || event.pointerId !== this.marqueePointerId) return
    const rect = this.marqueeRect
    this.cancelMarquee()
    if (rect) {
      this.suppressNextClick = true
      event.preventDefault()
      event.stopImmediatePropagation()
      this.openRegionEditor(rect)
      return
    }
    this.blockSelectionEvent(event)
  }

  private handlePointerCancel = (event: PointerEvent) => {
    if (!this.enabled || !event.isTrusted || event.pointerId !== this.marqueePointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.cancelMarquee()
  }

  private handleClick = (event: MouseEvent) => {
    if (!this.enabled || !event.isTrusted) return
    const pin = this.overlayPin(event)
    if (pin) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const annotation = this.annotations.find((candidate) => candidate.id === pin.dataset.annotationId)
      if (annotation) this.openAnnotationEditor(annotation)
      return
    }
    const element = this.pageEventElement(event)
    if (!element) return
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    this.openEditor({ mode: 'create-element', element })
  }

  handleKeyDown(event: KeyboardEvent) {
    if (!this.enabled || !event.isTrusted || event.key !== 'Escape') return false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.marqueeOrigin || this.marqueeRect) {
      this.cancelMarquee()
    } else if (this.editorElement) {
      this.closeEditor()
    } else {
      this.setEnabled(false)
    }
    return true
  }

  private handleWindowKeyDown = (event: KeyboardEvent) => {
    if (!this.handleKeyDown(event)) this.onUnhandledKeyDown?.(event)
  }

  private clearIframeShields() {
    for (const shield of this.iframeShields.values()) shield.remove()
    this.iframeShields.clear()
    this.shieldIframes.clear()
  }

  private updateIframeShields() {
    if (!this.enabled || !this.iframeShieldLayer) {
      this.clearIframeShields()
      return
    }

    const iframes = new Set<HTMLIFrameElement>()
    const collectIframes = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll('*')) {
        if (element instanceof HTMLIFrameElement) iframes.add(element)
        if (element.shadowRoot) collectIframes(element.shadowRoot)
      }
    }
    collectIframes(document)
    for (const [iframe, shield] of this.iframeShields) {
      if (iframes.has(iframe)) continue
      shield.remove()
      this.iframeShields.delete(iframe)
      this.shieldIframes.delete(shield)
    }

    for (const iframe of iframes) {
      let shield = this.iframeShields.get(iframe)
      if (!shield) {
        shield = document.createElement('div')
        shield.className = 'iframe-shield'
        this.iframeShieldLayer.appendChild(shield)
        this.iframeShields.set(iframe, shield)
        this.shieldIframes.set(shield, iframe)
      }
      const rect = iframe.getBoundingClientRect()
      shield.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none'
      shield.style.left = `${rect.left}px`
      shield.style.top = `${rect.top}px`
      shield.style.width = `${rect.width}px`
      shield.style.height = `${rect.height}px`
    }
  }

  private renderMarquee() {
    if (!this.marquee || !this.marqueeRect) return
    this.marquee.style.display = 'block'
    this.marquee.style.left = `${this.marqueeRect.left}px`
    this.marquee.style.top = `${this.marqueeRect.top}px`
    this.marquee.style.width = `${this.marqueeRect.width}px`
    this.marquee.style.height = `${this.marqueeRect.height}px`
  }

  private cancelMarquee() {
    const pointerCapture = this.marqueePointerCapture
    this.marqueePointerCapture = null
    this.marqueePointerId = null
    this.marqueeOrigin = null
    this.marqueeRect = null
    if (this.marquee) this.marquee.style.display = 'none'
    if (pointerCapture) {
      try {
        if (pointerCapture.target.hasPointerCapture(pointerCapture.pointerId)) {
          pointerCapture.target.releasePointerCapture(pointerCapture.pointerId)
        }
      } catch {
        // The element or pointer may already have been detached by the guest page.
      }
    }
  }

  /** Elements mostly inside the marquee, deduped so a contained container hides its descendants. */
  private collectRegionElements(rect: ViewportRect): Element[] {
    const right = rect.left + rect.width
    const bottom = rect.top + rect.height
    const candidates: Element[] = []
    let visited = 0

    const visit = (element: Element) => {
      if (visited >= REGION_WALK_BUDGET || element === this.overlayHost) return
      visited++
      const box = element.getBoundingClientRect()
      const overlapX = Math.min(right, box.right) - Math.max(rect.left, box.left)
      const overlapY = Math.min(bottom, box.bottom) - Math.max(rect.top, box.top)
      const area = box.width * box.height
      if (overlapX > 0 && overlapY > 0 && area > 0 && (overlapX * overlapY) / area >= REGION_CONTAINMENT_RATIO) {
        candidates.push(element)
      }
      if (element.shadowRoot) for (const child of Array.from(element.shadowRoot.children)) visit(child)
      for (const child of Array.from(element.children)) visit(child)
    }
    if (document.body) visit(document.body)

    const candidateSet = new Set(candidates)
    return candidates.filter((element) => {
      for (let parent = composedParent(element); parent; parent = composedParent(parent)) {
        if (candidateSet.has(parent)) return false
      }
      return true
    })
  }

  private openRegionEditor(rect: ViewportRect) {
    if (this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations) return

    const contained = this.collectRegionElements(rect)
    let centerElement: Element | null = null
    try {
      centerElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    } catch {
      // jsdom and detached documents do not implement elementFromPoint.
    }
    let anchor: Element | null =
      findCommonAncestor(contained) ?? (centerElement !== this.overlayHost ? centerElement : null) ?? document.body
    // Walk up until a selector can be built; <body> always can.
    while (anchor && !buildWebviewElementSelector(anchor)) anchor = composedParent(anchor)
    if (!anchor) return

    const elements: WebviewElementLocator[] = []
    for (const element of contained) {
      const locator = createWebviewElementLocator(element)
      if (locator) elements.push(locator)
      if (elements.length >= WEBVIEW_ANNOTATION_LIMITS.regionElements) break
    }

    this.openEditor({ mode: 'create-region', element: anchor, region: { rect: toPageRegionRect(rect), elements } })
  }

  private openEditor(request: EditorRequest) {
    const annotationId = request.mode === 'edit' ? request.annotationId : null
    if (!this.locale || (!annotationId && this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations)) return
    this.ensureOverlay()

    const annotation = annotationId ? this.annotations.find((item) => item.id === annotationId) : undefined
    this.closeEditor()
    this.editorElement = request.element
    this.editorAnnotationId = annotationId
    this.editorRequestId = createGuestUuid()
    this.editorRegion = request.mode === 'create-region' ? request.region.rect : (annotation?.region?.rect ?? null)
    this.pendingRegion = request.mode === 'create-region' ? request.region : null
    this.highlightElement = request.element
    const anchor = this.getEditorAnchorRect()
    if (!anchor) {
      this.closeEditor()
      return
    }
    this.editorAnchor = anchor
    this.schedulePositionUpdate()
    if (this.sessionId) {
      this.onStateChange({
        type: 'editor_requested',
        sessionId: this.sessionId,
        requestId: this.editorRequestId,
        comment: annotation?.comment ?? '',
        canDelete: Boolean(annotationId),
        anchor
      })
    }
  }

  private closeEditor() {
    const requestId = this.editorRequestId
    this.editorAnnotationId = null
    this.editorAnchor = null
    this.editorElement = null
    this.editorRequestId = null
    this.editorRegion = null
    this.pendingRegion = null
    this.highlightElement = null
    this.schedulePositionUpdate()
    if (requestId && this.sessionId) {
      this.onStateChange({ type: 'editor_closed', sessionId: this.sessionId, requestId })
    }
  }

  private saveEditor(requestId: string, draft: string) {
    if (requestId !== this.editorRequestId || !this.editorElement) return
    const comment = draft.trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)
    if (!comment) return

    if (this.editorAnnotationId) {
      const annotation = this.annotations.find((item) => item.id === this.editorAnnotationId)
      if (!annotation) return
      annotation.comment = comment
      // Region annotations keep their captured ancestor locator: the editor may
      // have fallen back to <body> when the ancestor no longer resolves.
      if (!annotation.region) {
        const locator = createWebviewElementLocator(this.editorElement)
        if (locator) annotation.element = locator
        this.annotationElements.set(annotation.id, this.editorElement)
      }
    } else {
      const locator = createWebviewElementLocator(this.editorElement)
      if (!locator) {
        if (this.sessionId) {
          this.onStateChange({
            type: 'editor_error',
            sessionId: this.sessionId,
            requestId,
            reason: 'element_unavailable'
          })
        }
        return
      }
      const annotation: WebviewAnnotation = {
        id: createGuestUuid(),
        comment,
        element: locator,
        ...(this.pendingRegion ? { region: this.pendingRegion } : {})
      }
      this.annotations.push(annotation)
      this.annotationElements.set(annotation.id, this.editorElement)
    }

    this.observeElementRoot(this.editorElement)
    this.closeEditor()
    this.renderPins()
    this.emitState()
  }

  private deleteEditorAnnotation(requestId: string) {
    if (requestId !== this.editorRequestId || !this.editorAnnotationId) return
    const annotationId = this.editorAnnotationId
    this.annotations = this.annotations.filter((annotation) => annotation.id !== annotationId)
    this.annotationElements.delete(annotationId)
    this.closeEditor()
    this.renderPins()
    this.emitState()
    if (!this.enabled && this.annotations.length === 0) {
      this.stopPositionTracking()
      this.removeOverlay()
    }
  }

  private renderPins() {
    if (!this.pinLayer) return
    this.pinLayer.replaceChildren()
    this.annotations.forEach((annotation, index) => {
      const pin = document.createElement('button')
      pin.type = 'button'
      pin.className = 'pin'
      pin.dataset.annotationId = annotation.id
      pin.textContent = String(index + 1)
      pin.setAttribute('aria-label', `${this.locale?.edit ?? ''} ${index + 1}`.trim())
      pin.addEventListener('click', () => this.openAnnotationEditor(annotation))
      this.pinLayer?.appendChild(pin)
    })
    this.startPositionTracking()
    this.schedulePositionUpdate()
  }

  private openAnnotationEditor(annotation: WebviewAnnotation) {
    const element = this.resolveAnnotationElement(annotation) ?? (annotation.region ? document.body : null)
    if (!element) return
    this.openEditor({ mode: 'edit', element, annotationId: annotation.id })
  }

  private startPositionTracking() {
    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (mutations.every((mutation) => this.overlayHost?.contains(mutation.target))) return
        this.schedulePositionUpdate()
      })
    }
    if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.schedulePositionUpdate)
    }
    this.syncObservedRoots()
    this.syncResizeObservedElements()
    window.addEventListener('scroll', this.schedulePositionUpdate, true)
    window.addEventListener('resize', this.schedulePositionUpdate)
    window.visualViewport?.addEventListener('scroll', this.schedulePositionUpdate)
    window.visualViewport?.addEventListener('resize', this.schedulePositionUpdate)
    this.schedulePositionUpdate()
  }

  private stopPositionTracking() {
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame)
      this.updateFrame = null
    }
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    for (const root of this.observedRoots) this.removeMotionListeners(root)
    this.observedRoots = new Set<Document | ShadowRoot>()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.resizeObservedElements.clear()
    window.removeEventListener('scroll', this.schedulePositionUpdate, true)
    window.removeEventListener('resize', this.schedulePositionUpdate)
    window.visualViewport?.removeEventListener('scroll', this.schedulePositionUpdate)
    window.visualViewport?.removeEventListener('resize', this.schedulePositionUpdate)
  }

  private observeRoot(root: Document | ShadowRoot) {
    if (!this.mutationObserver || this.observedRoots.has(root)) return
    this.mutationObserver.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
    for (const eventType of POSITION_MOTION_EVENTS) root.addEventListener(eventType, this.handleMotionEvent, true)
    this.observedRoots.add(root)
  }

  private removeMotionListeners(root: Document | ShadowRoot) {
    for (const eventType of POSITION_MOTION_EVENTS) root.removeEventListener(eventType, this.handleMotionEvent, true)
  }

  private observeElementRoot(element: Element) {
    for (let current: Element | null = element; current; current = composedParent(current)) {
      const root = current.getRootNode()
      if (root instanceof Document || root instanceof ShadowRoot) this.observeRoot(root)
    }
  }

  private syncObservedRoots() {
    if (!this.mutationObserver) return
    const next = new Set<Document | ShadowRoot>([document])
    const collect = (element: Element | null) => {
      for (let current = element; current?.isConnected; current = composedParent(current)) {
        const root = current.getRootNode()
        if (root instanceof Document || root instanceof ShadowRoot) next.add(root)
      }
    }
    for (const element of this.annotationElements.values()) collect(element)
    collect(this.editorElement)
    collect(this.highlightElement)
    if (this.enabled) for (const iframe of this.iframeShields.keys()) collect(iframe)

    if (next.size === this.observedRoots.size && Array.from(next).every((root) => this.observedRoots.has(root))) return
    this.mutationObserver.disconnect()
    for (const root of this.observedRoots) this.removeMotionListeners(root)
    this.observedRoots.clear()
    for (const root of next) this.observeRoot(root)
  }

  private syncResizeObservedElements() {
    if (!this.resizeObserver) return
    const next = new Set<Element>()
    const collect = (element: Element | null) => {
      for (let current = element; current?.isConnected; current = composedParent(current)) next.add(current)
    }
    for (const element of this.annotationElements.values()) collect(element)
    collect(this.editorElement)
    collect(this.highlightElement)
    if (this.enabled) for (const iframe of this.iframeShields.keys()) collect(iframe)

    for (const element of this.resizeObservedElements) {
      if (!next.has(element)) this.resizeObserver.unobserve(element)
    }
    for (const element of next) {
      if (!this.resizeObservedElements.has(element)) this.resizeObserver.observe(element)
    }
    this.resizeObservedElements = next
  }

  private schedulePositionUpdate = () => {
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      this.updatePositions()
      if (this.hasActiveTargetAnimations()) this.schedulePositionUpdate()
    })
  }

  private trackedPositionElements() {
    const elements = new Set<Element>()
    for (const annotation of this.annotations) {
      if (annotation.region) continue
      const element = this.annotationElements.get(annotation.id)
      if (element) elements.add(element)
    }
    if (this.editorElement) elements.add(this.editorElement)
    if (this.highlightElement) elements.add(this.highlightElement)
    if (this.enabled) for (const iframe of this.iframeShields.keys()) elements.add(iframe)
    return elements
  }

  private isTrackedElementOrAncestor(element: Element) {
    for (const tracked of this.trackedPositionElements()) {
      for (let current: Element | null = tracked; current; current = composedParent(current)) {
        if (current === element) return true
      }
    }
    return false
  }

  private hasActiveTargetAnimations() {
    if (!this.overlayHost?.isConnected) return false
    const visited = new Set<Element>()
    for (const tracked of this.trackedPositionElements()) {
      for (let current: Element | null = tracked; current?.isConnected; current = composedParent(current)) {
        if (visited.has(current)) continue
        visited.add(current)
        try {
          if (current.getAnimations?.().some((animation) => animation.playState === 'running' || animation.pending)) {
            return true
          }
        } catch {
          // Some guest elements can reject animation inspection while detaching.
        }
      }
    }
    return false
  }

  private handleMotionEvent = (event: Event) => {
    if (event.target instanceof Element && this.isTrackedElementOrAncestor(event.target)) {
      this.schedulePositionUpdate()
    }
  }

  private resolveAnnotationElement(annotation: WebviewAnnotation) {
    const knownElement = this.annotationElements.get(annotation.id)
    if (knownElement?.isConnected) return knownElement
    this.annotationElements.delete(annotation.id)
    const resolved = resolveWebviewElementSelector(annotation.element.selector)
    if (resolved) {
      this.annotationElements.set(annotation.id, resolved)
      this.observeElementRoot(resolved)
    }
    return resolved
  }

  private updatePositions() {
    if (!this.overlayHost) return
    if (!this.overlayHost.isConnected) document.documentElement?.appendChild(this.overlayHost)
    this.updateIframeShields()

    this.annotations.forEach((annotation) => {
      const pin = this.pinLayer?.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
      if (!pin) return
      if (annotation.region) {
        const knownElement = this.annotationElements.get(annotation.id)
        if (knownElement && !knownElement.isConnected) this.annotationElements.delete(annotation.id)
        // Region pins are geometric: they follow window scroll, not element resolution.
        pin.style.display = ''
        pin.style.left = `${Math.max(4, annotation.region.rect.x - window.scrollX)}px`
        pin.style.top = `${Math.max(4, annotation.region.rect.y - window.scrollY)}px`
        return
      }
      const element = this.resolveAnnotationElement(annotation)
      if (!element) {
        pin.style.display = 'none'
        return
      }
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        pin.style.display = 'none'
        return
      }
      pin.style.display = ''
      pin.style.left = `${Math.max(4, rect.left)}px`
      pin.style.top = `${Math.max(4, rect.top)}px`
    })
    this.syncResizeObservedElements()
    this.syncObservedRoots()

    const highlightedElement = this.highlightElement
    if (this.highlight && highlightedElement?.isConnected) {
      const rect = highlightedElement.getBoundingClientRect()
      this.highlight.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none'
      this.highlight.style.left = `${rect.left}px`
      this.highlight.style.top = `${rect.top}px`
      this.highlight.style.width = `${rect.width}px`
      this.highlight.style.height = `${rect.height}px`
    } else if (this.highlight) {
      this.highlight.style.display = 'none'
    }

    const editorAnchor = this.getEditorAnchorRect()
    if (editorAnchor && this.editorRequestId && this.sessionId && !anchorRectsEqual(this.editorAnchor, editorAnchor)) {
      this.editorAnchor = editorAnchor
      this.onStateChange({
        type: 'editor_anchor_changed',
        sessionId: this.sessionId,
        requestId: this.editorRequestId,
        anchor: editorAnchor
      })
    }
  }

  private getEditorAnchorRect(): WebviewAnnotationAnchorRect | null {
    if (this.editorRegion) {
      return toAnchorRect({
        left: this.editorRegion.x - window.scrollX,
        top: this.editorRegion.y - window.scrollY,
        width: this.editorRegion.width,
        height: this.editorRegion.height
      })
    }
    if (!this.editorElement?.isConnected) return null
    const rect = this.editorElement.getBoundingClientRect()
    return toAnchorRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
  }
}
