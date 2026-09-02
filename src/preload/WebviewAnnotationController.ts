import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnnotation,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationRegion,
  type WebviewAnnotationState,
  type WebviewAnnotationTheme,
  type WebviewElementLocator,
  type WebviewRegionRect
} from '@shared/types/webviewAnnotation'

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

  .editor {
    position: fixed;
    display: none;
    width: min(320px, calc(100vw - 24px));
    padding: 12px;
    border: 1px solid var(--annotation-border);
    border-radius: 10px;
    background: var(--annotation-surface);
    color: var(--annotation-text);
    box-shadow: 0 12px 40px color-mix(in srgb, black 28%, transparent);
    pointer-events: auto;
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 88px;
    max-height: 240px;
    resize: vertical;
    padding: 9px 10px;
    border: 1px solid var(--annotation-border);
    border-radius: 7px;
    background: var(--annotation-input);
    color: var(--annotation-text);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  textarea:focus {
    border-color: var(--annotation-accent);
    outline: 2px solid color-mix(in srgb, var(--annotation-accent) 30%, transparent);
    outline-offset: 1px;
  }

  .editor-error {
    display: none;
    margin: 8px 2px 0;
    color: var(--annotation-danger);
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }

  button.action {
    min-height: 30px;
    padding: 5px 10px;
    border: 1px solid var(--annotation-border);
    border-radius: 7px;
    background: var(--annotation-input);
    color: var(--annotation-text);
    cursor: pointer;
    font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  button.action.primary {
    border-color: var(--annotation-accent);
    background: var(--annotation-accent);
    color: white;
  }

  button.action.danger {
    margin-right: auto;
    border-color: var(--annotation-danger);
    color: var(--annotation-danger);
  }

  button.action:disabled {
    cursor: default;
    opacity: 0.45;
  }

  button.action:focus-visible {
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

type StateListener = (state: WebviewAnnotationState, navigationRevision: number) => void

export class WebviewAnnotationController {
  private annotations: WebviewAnnotation[] = []
  private annotationElements = new Map<string, Element>()
  private configured = false
  private editorAnnotationId: string | null = null
  private editorElement: Element | null = null
  /** Page-coordinate rect anchoring the editor/highlight while a region is being created or edited. */
  private editorRegion: WebviewRegionRect | null = null
  private enabled = false
  private highlightElement: Element | null = null
  private marquee: HTMLDivElement | null = null
  private marqueePointerCapture: { target: Element; pointerId: number } | null = null
  private marqueeOrigin: { x: number; y: number } | null = null
  private marqueeRect: ViewportRect | null = null
  private pendingRegion: WebviewAnnotationRegion | null = null
  private suppressNextClick = false
  private locale: WebviewAnnotationLocale | null = null
  private mutationObserver: MutationObserver | null = null
  private navigationRevision = 0
  private observedRoots = new Set<Document | ShadowRoot>()
  private overlayHost: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private pinLayer: HTMLDivElement | null = null
  private editor: HTMLDivElement | null = null
  private editorError: HTMLDivElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private saveButton: HTMLButtonElement | null = null
  private theme: WebviewAnnotationTheme = 'light'
  private updateFrame: number | null = null

  constructor(private readonly onStateChange: StateListener) {}

  handleCommand(command: WebviewAnnotationHostCommand) {
    switch (command.type) {
      case 'configure':
        this.configured = true
        this.locale = command.locale
        this.theme = command.theme
        this.applyTheme()
        this.updateEditorLabels()
        break
      case 'set_enabled':
        this.setEnabled(command.enabled)
        break
      case 'clear':
        this.clearAnnotations()
        break
      case 'reset':
        this.reset()
        break
      case 'reset_for_navigation':
        this.navigationRevision = command.navigationRevision
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

  private reset() {
    this.clearAnnotations(false)
    this.enabled = false
    this.removeSelectionListeners()
    this.cancelMarquee()
    this.stopPositionTracking()
    this.removeOverlay()
    this.emitState()
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
    this.onStateChange(this.getState(), this.navigationRevision)
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
    const editor = this.createEditor()

    shadowRoot.append(highlight, marquee, pinLayer, editor)
    document.documentElement?.appendChild(host)

    this.overlayHost = host
    this.highlight = highlight
    this.marquee = marquee
    this.pinLayer = pinLayer
    this.editor = editor
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
    this.editor = null
    this.editorError = null
    this.textarea = null
    this.saveButton = null
  }

  private createEditor() {
    const editor = document.createElement('div')
    editor.className = 'editor'

    const textarea = document.createElement('textarea')
    textarea.maxLength = WEBVIEW_ANNOTATION_LIMITS.comment
    textarea.addEventListener('input', () => {
      if (this.saveButton) this.saveButton.disabled = textarea.value.trim().length === 0
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.closeEditor()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        this.saveEditor()
      }
    })

    const actions = document.createElement('div')
    actions.className = 'actions'

    const editorError = document.createElement('div')
    editorError.className = 'editor-error'
    editorError.setAttribute('role', 'alert')

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'action danger'
    deleteButton.dataset.action = 'delete'
    deleteButton.addEventListener('click', () => this.deleteEditorAnnotation())

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'action'
    cancelButton.dataset.action = 'cancel'
    cancelButton.addEventListener('click', () => this.closeEditor())

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.className = 'action primary'
    saveButton.dataset.action = 'save'
    saveButton.addEventListener('click', () => this.saveEditor())

    actions.append(deleteButton, cancelButton, saveButton)
    editor.append(textarea, editorError, actions)
    this.editorError = editorError
    this.textarea = textarea
    this.saveButton = saveButton
    this.updateEditorLabels(editor)
    return editor
  }

  private updateEditorLabels(editor = this.editor) {
    if (!editor || !this.locale) return
    if (this.textarea) {
      this.textarea.placeholder = this.locale.placeholder
      this.textarea.setAttribute('aria-label', this.locale.placeholder)
    }
    if (this.editorError) this.editorError.textContent = this.locale.elementUnavailable
    const deleteButton = editor.querySelector<HTMLButtonElement>('[data-action="delete"]')
    const cancelButton = editor.querySelector<HTMLButtonElement>('[data-action="cancel"]')
    const saveButton = editor.querySelector<HTMLButtonElement>('[data-action="save"]')
    if (deleteButton) deleteButton.textContent = this.locale.delete
    if (cancelButton) cancelButton.textContent = this.locale.cancel
    if (saveButton) saveButton.textContent = this.locale.save
  }

  private addSelectionListeners() {
    document.addEventListener('pointermove', this.handlePointerMove, true)
    document.addEventListener('pointerdown', this.handlePointerDown, true)
    document.addEventListener('pointerup', this.handlePointerUp, true)
    document.addEventListener('pointercancel', this.handlePointerCancel, true)
    document.addEventListener('lostpointercapture', this.handlePointerCancel, true)
    document.addEventListener('mousedown', this.blockSelectionEvent, true)
    document.addEventListener('mouseup', this.blockSelectionEvent, true)
    document.addEventListener('click', this.handleClick, true)
    document.addEventListener('keydown', this.handleDocumentKeyDown, true)
  }

  private removeSelectionListeners() {
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerdown', this.handlePointerDown, true)
    document.removeEventListener('pointerup', this.handlePointerUp, true)
    document.removeEventListener('pointercancel', this.handlePointerCancel, true)
    document.removeEventListener('lostpointercapture', this.handlePointerCancel, true)
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
    const element = this.eventElement(event)
    if (!this.enabled || this.isOverlayEvent(event) || !element) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.button === 0) {
      this.marqueeOrigin = { x: event.clientX, y: event.clientY }
      try {
        element.setPointerCapture(event.pointerId)
        this.marqueePointerCapture = { target: element, pointerId: event.pointerId }
      } catch {
        // Document-level listeners still handle runtimes without pointer capture.
      }
    }
  }

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.enabled) return
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
    if (!this.enabled || (!this.marqueeOrigin && !this.marqueeRect && !this.marqueePointerCapture)) return
    if (this.marqueePointerCapture && event.pointerId !== this.marqueePointerCapture.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.cancelMarquee()
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
    this.openEditor(element)
  }

  private handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || event.key !== 'Escape' || this.isOverlayEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.marqueeOrigin || this.marqueeRect) {
      this.cancelMarquee()
    } else if (this.editorElement) {
      this.closeEditor()
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
    const pointerCapture = this.marqueePointerCapture
    this.marqueePointerCapture = null
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

    const pageRect: WebviewRegionRect = {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    const elements = contained
      .map(createWebviewElementLocator)
      .filter((locator): locator is WebviewElementLocator => locator !== null)
      .slice(0, WEBVIEW_ANNOTATION_LIMITS.regionElements)

    this.pendingRegion = { rect: pageRect, elements }
    this.editorRegion = pageRect
    this.openEditor(anchor)
  }

  private openEditor(element: Element, annotationId: string | null = null) {
    if (!this.locale || (!annotationId && this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations)) return
    this.ensureOverlay()
    if (!this.editor || !this.textarea || !this.saveButton) return

    const annotation = annotationId ? this.annotations.find((item) => item.id === annotationId) : undefined
    this.editorElement = element
    this.editorAnnotationId = annotationId
    if (this.editorError) this.editorError.style.display = 'none'
    this.textarea.value = annotation?.comment ?? ''
    this.textarea.placeholder = this.locale.placeholder
    this.saveButton.disabled = this.textarea.value.trim().length === 0
    const deleteButton = this.editor.querySelector<HTMLButtonElement>('[data-action="delete"]')
    if (deleteButton) deleteButton.style.display = annotationId ? '' : 'none'
    this.editor.style.display = 'block'
    this.highlightElement = element
    this.schedulePositionUpdate()
    this.textarea.focus()
  }

  private closeEditor() {
    this.editorAnnotationId = null
    this.editorElement = null
    this.editorRegion = null
    this.pendingRegion = null
    if (this.editorError) this.editorError.style.display = 'none'
    if (this.editor) this.editor.style.display = 'none'
    this.schedulePositionUpdate()
  }

  private saveEditor() {
    if (!this.editorElement || !this.textarea) return
    const comment = this.textarea.value.trim().slice(0, WEBVIEW_ANNOTATION_LIMITS.comment)
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
        if (this.editorError) this.editorError.style.display = 'block'
        return
      }
      const annotation: WebviewAnnotation = {
        id: crypto.randomUUID(),
        comment,
        createdAt: Date.now(),
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

  private deleteEditorAnnotation() {
    if (!this.editorAnnotationId) return
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
      pin.addEventListener('click', () => {
        const element = this.resolveAnnotationElement(annotation) ?? (annotation.region ? document.body : null)
        if (!element) return
        if (annotation.region) this.editorRegion = annotation.region.rect
        this.openEditor(element, annotation.id)
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

    const anchorRect = this.getEditorAnchorRect()
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

    if (this.editor && anchorRect) {
      const editorRect = this.editor.getBoundingClientRect()
      const margin = 8
      const left = Math.min(
        Math.max(margin, anchorRect.left),
        Math.max(margin, window.innerWidth - editorRect.width - margin)
      )
      const belowTop = anchorRect.top + anchorRect.height + margin
      const top =
        belowTop + editorRect.height <= window.innerHeight - margin
          ? belowTop
          : Math.max(margin, anchorRect.top - editorRect.height - margin)
      this.editor.style.left = `${left}px`
      this.editor.style.top = `${top}px`
    }
  }

  /** Viewport rect the editor and highlight anchor to: the region box when set, else the editor element. */
  private getEditorAnchorRect(): ViewportRect | null {
    if (this.editorRegion) {
      return {
        left: this.editorRegion.x - window.scrollX,
        top: this.editorRegion.y - window.scrollY,
        width: this.editorRegion.width,
        height: this.editorRegion.height
      }
    }
    if (this.editorElement?.isConnected) {
      const rect = this.editorElement.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    return null
  }
}
