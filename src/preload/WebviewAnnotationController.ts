import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnchorRect,
  type WebviewAnnotation,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationRegion,
  type WebviewAnnotationState,
  type WebviewAnnotationTheme,
  type WebviewElementLocator,
  type WebviewRegionRect
} from '@shared/types/webview'

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy'] as const
const FORM_ELEMENTS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])
const MARQUEE_DRAG_THRESHOLD_PX = 5
/** An element counts as inside the marquee when this share of its area overlaps the box. */
const REGION_CONTAINMENT_RATIO = 0.6
// ponytail: flat visit cap instead of spatial pruning — absolutely positioned
// children can escape their parent's box, so subtree pruning would miss them.
const REGION_WALK_BUDGET = 5_000

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

  /* The comment editor is host-rendered React; this overlay only draws selection chrome. */
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

const escapeAttributeValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

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

const summarizeText = (element: Element) => {
  if (FORM_ELEMENTS.has(element.tagName)) return null
  const text = element instanceof HTMLElement ? element.innerText : element.textContent
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized ? normalized.slice(0, WEBVIEW_ANNOTATION_LIMITS.text) : null
}

/** Layout-relevant computed styles; values matching these defaults are omitted as noise. */
const STYLE_PROPERTY_DEFAULTS: readonly (readonly [property: string, defaults: readonly string[]])[] = [
  ['position', ['static']],
  ['display', []],
  ['z-index', ['auto']],
  ['top', ['auto']],
  ['right', ['auto']],
  ['bottom', ['auto']],
  ['left', ['auto']],
  ['width', ['auto']],
  ['height', ['auto']],
  ['margin', ['0px']],
  ['padding', ['0px']],
  ['transform', ['none']],
  ['float', ['none']],
  ['overflow', ['visible']],
  ['flex', ['0 1 auto']],
  ['gap', ['normal', 'normal normal']]
]

const summarizeComputedStyles = (element: Element): string | undefined => {
  const view = element.ownerDocument?.defaultView
  if (!view) return undefined
  let computed: CSSStyleDeclaration
  try {
    computed = view.getComputedStyle(element)
  } catch {
    return undefined
  }

  const parts: string[] = []
  for (const [property, defaults] of STYLE_PROPERTY_DEFAULTS) {
    const value = computed.getPropertyValue(property).trim()
    if (!value || defaults.includes(value)) continue
    parts.push(`${property}: ${value}`)
  }
  return parts.length > 0 ? parts.join('; ').slice(0, WEBVIEW_ANNOTATION_LIMITS.styleText) : undefined
}

export function createWebviewElementLocator(element: Element): WebviewElementLocator | null {
  const selector = buildWebviewElementSelector(element)
  if (!selector) return null

  const ariaLabel = element.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() || null
  const role = element.getAttribute('role')?.replace(/\s+/g, ' ').trim() || null
  const styles = summarizeComputedStyles(element)

  return {
    selector,
    tagName: element.tagName.toLowerCase().slice(0, WEBVIEW_ANNOTATION_LIMITS.tagName),
    text: summarizeText(element),
    ariaLabel: ariaLabel?.slice(0, WEBVIEW_ANNOTATION_LIMITS.ariaLabel) ?? null,
    role: role?.slice(0, WEBVIEW_ANNOTATION_LIMITS.role) ?? null,
    ...(styles ? { styles } : {})
  }
}

interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

const composedParent = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

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

type GuestEventListener = (event: WebviewAnnotationGuestEvent) => void
type GuestEventPayload<T = WebviewAnnotationGuestEvent> = T extends unknown ? Omit<T, 'documentId'> : never

export class WebviewAnnotationController {
  private annotations: WebviewAnnotation[] = []
  private annotationElements = new Map<string, Element>()
  private configured = false
  private documentId: string | null = null
  private enabled = false
  private highlightElement: Element | null = null
  private marquee: HTMLDivElement | null = null
  private marqueeOrigin: { x: number; y: number } | null = null
  private marqueeRect: ViewportRect | null = null
  private pendingElement: Element | null = null
  private pendingLocator: WebviewElementLocator | null = null
  private pendingRegion: WebviewAnnotationRegion | null = null
  /** Page-coordinate rect anchoring the highlight while a region selection is pending. */
  private pendingRegionRect: WebviewRegionRect | null = null
  private suppressNextClick = false
  private locale: WebviewAnnotationLocale | null = null
  private mutationObserver: MutationObserver | null = null
  private observedRoots = new Set<Document | ShadowRoot>()
  private overlayHost: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private pinLayer: HTMLDivElement | null = null
  private theme: WebviewAnnotationTheme = 'light'
  private updateFrame: number | null = null

  constructor(private readonly onEvent: GuestEventListener) {}

  handleCommand(command: WebviewAnnotationHostCommand) {
    switch (command.type) {
      case 'configure': {
        const documentChanged = this.documentId !== command.documentId
        this.documentId = command.documentId
        this.configured = true
        this.locale = command.locale
        this.theme = command.theme
        if (documentChanged) this.reset()
        this.applyTheme()
        break
      }
      case 'set_enabled':
        this.setEnabled(command.enabled)
        break
      case 'commit_pending':
        this.commitPending(command.id, command.comment)
        break
      case 'cancel_pending':
        this.clearPending()
        break
      case 'update_annotation':
        this.updateAnnotation(command.id, command.comment)
        break
      case 'delete_annotation':
        this.deleteAnnotation(command.id)
        break
      case 'clear':
        this.clearAnnotations()
        break
      case 'reset':
        this.reset()
        break
      case 'request_state':
        this.emitState()
        break
    }
  }

  getState(): WebviewAnnotationState {
    return {
      enabled: this.enabled,
      annotations: this.annotations.map((annotation) => ({
        ...annotation,
        element: { ...annotation.element },
        ...(annotation.region
          ? {
              region: {
                rect: { ...annotation.region.rect },
                elements: annotation.region.elements.map((element) => ({ ...element }))
              }
            }
          : {})
      }))
    }
  }

  dispose() {
    this.enabled = false
    this.removeSelectionListeners()
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
      this.addSelectionListeners()
      this.startPositionTracking()
    } else {
      this.removeSelectionListeners()
      this.cancelMarquee()
      this.clearPending(true)
      this.highlightElement = null
      this.schedulePositionUpdate()
      if (this.annotations.length === 0) {
        this.stopPositionTracking()
        this.removeOverlay()
      }
    }
    this.emitState()
  }

  private reset() {
    this.clearAnnotations(false)
    this.enabled = false
    this.removeSelectionListeners()
    this.stopPositionTracking()
    this.removeOverlay()
    this.emitState()
  }

  private clearAnnotations(emit = true) {
    this.annotations = []
    this.annotationElements.clear()
    this.clearPending(true)
    this.renderPins()
    if (emit) this.emitState()
    if (!this.enabled) {
      this.stopPositionTracking()
      this.removeOverlay()
    }
  }

  private emitState() {
    this.emitEvent({ type: 'state_changed', state: this.getState() })
  }

  private emitEvent(event: GuestEventPayload) {
    if (!this.documentId) return
    this.onEvent({ ...event, documentId: this.documentId } as WebviewAnnotationGuestEvent)
  }

  private toAnchorRect(rect: ViewportRect): WebviewAnchorRect {
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    }
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
    const pinLayer = document.createElement('div')

    shadowRoot.append(highlight, marquee, pinLayer)
    document.documentElement?.appendChild(host)

    this.overlayHost = host
    this.highlight = highlight
    this.marquee = marquee
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
    this.overlayHost.style.setProperty('--annotation-border', dark ? '#475569' : '#cbd5e1', 'important')
    this.overlayHost.style.setProperty('--annotation-danger', dark ? '#fca5a5' : '#dc2626', 'important')
    this.overlayHost.style.setProperty('--annotation-focus', dark ? '#c7d2fe' : '#3730a3', 'important')
    this.overlayHost.style.setProperty('--annotation-input', dark ? '#1e293b' : '#f8fafc', 'important')
    this.overlayHost.style.setProperty('--annotation-surface', dark ? '#0f172a' : '#ffffff', 'important')
    this.overlayHost.style.setProperty('--annotation-text', dark ? '#f8fafc' : '#0f172a', 'important')
  }

  private removeOverlay() {
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame)
      this.updateFrame = null
    }
    this.overlayHost?.remove()
    this.overlayHost = null
    this.highlight = null
    this.marquee = null
    this.pinLayer = null
  }

  private addSelectionListeners() {
    document.addEventListener('pointermove', this.handlePointerMove, true)
    document.addEventListener('pointerdown', this.handlePointerDown, true)
    document.addEventListener('pointerup', this.handlePointerUp, true)
    document.addEventListener('mousedown', this.blockSelectionEvent, true)
    document.addEventListener('mouseup', this.blockSelectionEvent, true)
    document.addEventListener('click', this.handleClick, true)
    document.addEventListener('keydown', this.handleDocumentKeyDown, true)
  }

  private removeSelectionListeners() {
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerdown', this.handlePointerDown, true)
    document.removeEventListener('pointerup', this.handlePointerUp, true)
    document.removeEventListener('mousedown', this.blockSelectionEvent, true)
    document.removeEventListener('mouseup', this.blockSelectionEvent, true)
    document.removeEventListener('click', this.handleClick, true)
    document.removeEventListener('keydown', this.handleDocumentKeyDown, true)
  }

  private isOverlayEvent(event: Event) {
    return Boolean(this.overlayHost && event.composedPath().includes(this.overlayHost))
  }

  private eventElement(event: Event): Element | null {
    for (const target of event.composedPath()) {
      if (target instanceof Element && target !== this.overlayHost) return target
    }
    return event.target instanceof Element ? event.target : null
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.enabled) return
    if (this.marqueeOrigin) {
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
        return
      }
    }
    if (this.isOverlayEvent(event)) return
    this.highlightElement = this.eventElement(event)
    this.schedulePositionUpdate()
  }

  private blockSelectionEvent = (event: Event) => {
    if (!this.enabled || this.isOverlayEvent(event) || !this.eventElement(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (!this.enabled || this.isOverlayEvent(event) || !this.eventElement(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.button === 0) this.marqueeOrigin = { x: event.clientX, y: event.clientY }
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.enabled) return
    const rect = this.marqueeRect
    this.marqueeOrigin = null
    if (rect) {
      this.cancelMarquee()
      this.suppressNextClick = true
      event.preventDefault()
      event.stopImmediatePropagation()
      this.startPendingRegion(rect)
      return
    }
    this.blockSelectionEvent(event)
  }

  private handleClick = (event: MouseEvent) => {
    if (!this.enabled) return
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (this.isOverlayEvent(event)) return
    const element = this.eventElement(event)
    if (!element) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.startPendingSelection(element)
  }

  private handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || event.key !== 'Escape' || this.isOverlayEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.marqueeOrigin || this.marqueeRect) {
      this.cancelMarquee()
    } else if (this.pendingElement) {
      this.clearPending(true)
    } else {
      this.setEnabled(false)
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
    this.marqueeOrigin = null
    this.marqueeRect = null
    if (this.marquee) this.marquee.style.display = 'none'
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

  private startPendingRegion(rect: ViewportRect) {
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
    const locator = anchor ? createWebviewElementLocator(anchor) : null
    if (!anchor || !locator) return

    const pageRect: WebviewRegionRect = {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    const elements = contained
      .map(createWebviewElementLocator)
      .filter((elementLocator): elementLocator is WebviewElementLocator => elementLocator !== null)
      .slice(0, WEBVIEW_ANNOTATION_LIMITS.regionElements)

    this.pendingElement = anchor
    this.pendingLocator = locator
    this.pendingRegion = { rect: pageRect, elements }
    this.pendingRegionRect = pageRect
    this.highlightElement = null
    this.schedulePositionUpdate()
    this.emitEvent({
      type: 'selection_pending',
      selection: { element: locator, region: this.pendingRegion, anchor: this.toAnchorRect(rect) }
    })
  }

  private startPendingSelection(element: Element) {
    if (this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations) return
    const locator = createWebviewElementLocator(element)
    if (!locator) return

    this.pendingElement = element
    this.pendingLocator = locator
    this.pendingRegion = null
    this.pendingRegionRect = null
    this.highlightElement = element
    this.schedulePositionUpdate()
    const rect = element.getBoundingClientRect()
    this.emitEvent({
      type: 'selection_pending',
      selection: {
        element: locator,
        anchor: this.toAnchorRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      }
    })
  }

  private clearPending(notifyHost = false) {
    const hadPending = this.pendingElement !== null
    this.pendingElement = null
    this.pendingLocator = null
    this.pendingRegion = null
    this.pendingRegionRect = null
    this.schedulePositionUpdate()
    if (notifyHost && hadPending) this.emitEvent({ type: 'selection_cleared' })
  }

  private commitPending(id: string, comment: string) {
    if (!this.pendingElement || !this.pendingLocator) return
    const trimmed = comment.trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)
    if (!trimmed || this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations) {
      this.clearPending()
      return
    }
    if (this.annotations.some((annotation) => annotation.id === id)) return

    const annotation: WebviewAnnotation = {
      id,
      comment: trimmed,
      createdAt: Date.now(),
      element: this.pendingLocator,
      ...(this.pendingRegion ? { region: this.pendingRegion } : {})
    }
    this.annotations.push(annotation)
    this.annotationElements.set(id, this.pendingElement)
    this.observeElementRoot(this.pendingElement)
    this.clearPending()
    this.renderPins()
    this.emitState()
  }

  private updateAnnotation(id: string, comment: string) {
    const annotation = this.annotations.find((item) => item.id === id)
    const trimmed = comment.trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)
    if (!annotation || !trimmed) return
    annotation.comment = trimmed
    this.emitState()
  }

  private deleteAnnotation(id: string) {
    const remaining = this.annotations.filter((annotation) => annotation.id !== id)
    if (remaining.length === this.annotations.length) return
    this.annotations = remaining
    this.annotationElements.delete(id)
    this.renderPins()
    this.emitState()
    if (!this.enabled && this.annotations.length === 0) {
      this.stopPositionTracking()
      this.removeOverlay()
    }
  }

  private getAnnotationAnchorRect(annotation: WebviewAnnotation): ViewportRect | null {
    if (annotation.region) {
      return {
        left: annotation.region.rect.x - window.scrollX,
        top: annotation.region.rect.y - window.scrollY,
        width: annotation.region.rect.width,
        height: annotation.region.rect.height
      }
    }
    const element = this.resolveAnnotationElement(annotation)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
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
      pin.addEventListener('click', () => {
        const anchor = this.getAnnotationAnchorRect(annotation)
        if (!anchor) return
        this.emitEvent({ type: 'annotation_activated', id: annotation.id, anchor: this.toAnchorRect(anchor) })
      })
      this.pinLayer?.appendChild(pin)
    })
    this.startPositionTracking()
    this.schedulePositionUpdate()
  }

  private startPositionTracking() {
    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (mutations.every((mutation) => this.overlayHost?.contains(mutation.target))) return
        this.schedulePositionUpdate()
      })
    }
    this.observeRoot(document)
    window.addEventListener('scroll', this.schedulePositionUpdate, true)
    window.addEventListener('resize', this.schedulePositionUpdate)
    window.visualViewport?.addEventListener('scroll', this.schedulePositionUpdate)
    window.visualViewport?.addEventListener('resize', this.schedulePositionUpdate)
    this.schedulePositionUpdate()
  }

  private stopPositionTracking() {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    this.observedRoots.clear()
    window.removeEventListener('scroll', this.schedulePositionUpdate, true)
    window.removeEventListener('resize', this.schedulePositionUpdate)
    window.visualViewport?.removeEventListener('scroll', this.schedulePositionUpdate)
    window.visualViewport?.removeEventListener('resize', this.schedulePositionUpdate)
  }

  private observeRoot(root: Document | ShadowRoot) {
    if (!this.mutationObserver || this.observedRoots.has(root)) return
    this.mutationObserver.observe(root, { childList: true, subtree: true, attributes: true })
    this.observedRoots.add(root)
  }

  private observeElementRoot(element: Element) {
    const root = element.getRootNode()
    if (root instanceof Document || root instanceof ShadowRoot) this.observeRoot(root)
  }

  private schedulePositionUpdate = () => {
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      this.updatePositions()
    })
  }

  private resolveAnnotationElement(annotation: WebviewAnnotation) {
    const knownElement = this.annotationElements.get(annotation.id)
    if (knownElement?.isConnected) return knownElement
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

    this.annotations.forEach((annotation) => {
      const pin = this.pinLayer?.querySelector<HTMLElement>(`[data-annotation-id="${annotation.id}"]`)
      if (!pin) return
      if (annotation.region) {
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

    const anchorRect = this.getPendingAnchorRect()
    const highlightedElement = this.highlightElement
    if (this.highlight && anchorRect) {
      this.highlight.style.display = anchorRect.width > 0 && anchorRect.height > 0 ? 'block' : 'none'
      this.highlight.style.left = `${anchorRect.left}px`
      this.highlight.style.top = `${anchorRect.top}px`
      this.highlight.style.width = `${anchorRect.width}px`
      this.highlight.style.height = `${anchorRect.height}px`
    } else if (this.highlight && highlightedElement?.isConnected) {
      const rect = highlightedElement.getBoundingClientRect()
      this.highlight.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none'
      this.highlight.style.left = `${rect.left}px`
      this.highlight.style.top = `${rect.top}px`
      this.highlight.style.width = `${rect.width}px`
      this.highlight.style.height = `${rect.height}px`
    } else if (this.highlight) {
      this.highlight.style.display = 'none'
    }
  }

  /** Viewport rect the highlight anchors to while a selection awaits the host editor. */
  private getPendingAnchorRect(): ViewportRect | null {
    if (this.pendingRegionRect) {
      return {
        left: this.pendingRegionRect.x - window.scrollX,
        top: this.pendingRegionRect.y - window.scrollY,
        width: this.pendingRegionRect.width,
        height: this.pendingRegionRect.height
      }
    }
    if (this.pendingElement?.isConnected) {
      const rect = this.pendingElement.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    return null
  }
}
