import {
  WEBVIEW_ANNOTATION_LIMITS,
  WEBVIEW_SHADOW_SELECTOR_SEPARATOR,
  type WebviewAnnotation,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationState,
  type WebviewAnnotationTheme,
  type WebviewElementLocator
} from '@shared/types/webview'

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy'] as const
const FORM_ELEMENTS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])

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

type StateListener = (state: WebviewAnnotationState) => void

export class WebviewAnnotationController {
  private annotations: WebviewAnnotation[] = []
  private annotationElements = new Map<string, Element>()
  private configured = false
  private editorAnnotationId: string | null = null
  private editorElement: Element | null = null
  private enabled = false
  private highlightElement: Element | null = null
  private locale: WebviewAnnotationLocale | null = null
  private mutationObserver: MutationObserver | null = null
  private observedRoots = new Set<Document | ShadowRoot>()
  private overlayHost: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private pinLayer: HTMLDivElement | null = null
  private editor: HTMLDivElement | null = null
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
        element: { ...annotation.element }
      }))
    }
  }

  dispose() {
    this.enabled = false
    this.removeSelectionListeners()
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
    this.onStateChange(this.getState())
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
    const pinLayer = document.createElement('div')
    const editor = this.createEditor()

    shadowRoot.append(highlight, pinLayer, editor)
    document.documentElement?.appendChild(host)

    this.overlayHost = host
    this.highlight = highlight
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
    this.pinLayer = null
    this.editor = null
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
    editor.append(textarea, actions)
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
    const deleteButton = editor.querySelector<HTMLButtonElement>('[data-action="delete"]')
    const cancelButton = editor.querySelector<HTMLButtonElement>('[data-action="cancel"]')
    const saveButton = editor.querySelector<HTMLButtonElement>('[data-action="save"]')
    if (deleteButton) deleteButton.textContent = this.locale.delete
    if (cancelButton) cancelButton.textContent = this.locale.cancel
    if (saveButton) saveButton.textContent = this.locale.save
  }

  private addSelectionListeners() {
    document.addEventListener('pointermove', this.handlePointerMove, true)
    document.addEventListener('pointerdown', this.blockSelectionEvent, true)
    document.addEventListener('pointerup', this.blockSelectionEvent, true)
    document.addEventListener('mousedown', this.blockSelectionEvent, true)
    document.addEventListener('mouseup', this.blockSelectionEvent, true)
    document.addEventListener('click', this.handleClick, true)
    document.addEventListener('keydown', this.handleDocumentKeyDown, true)
  }

  private removeSelectionListeners() {
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerdown', this.blockSelectionEvent, true)
    document.removeEventListener('pointerup', this.blockSelectionEvent, true)
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
    if (!this.enabled || this.isOverlayEvent(event)) return
    this.highlightElement = this.eventElement(event)
    this.schedulePositionUpdate()
  }

  private blockSelectionEvent = (event: Event) => {
    if (!this.enabled || this.isOverlayEvent(event) || !this.eventElement(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private handleClick = (event: MouseEvent) => {
    if (!this.enabled || this.isOverlayEvent(event)) return
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
    if (this.editorElement) {
      this.closeEditor()
    } else {
      this.setEnabled(false)
    }
  }

  private openEditor(element: Element, annotationId: string | null = null) {
    if (!this.locale || (!annotationId && this.annotations.length >= WEBVIEW_ANNOTATION_LIMITS.annotations)) return
    this.ensureOverlay()
    if (!this.editor || !this.textarea || !this.saveButton) return

    const annotation = annotationId ? this.annotations.find((item) => item.id === annotationId) : undefined
    this.editorElement = element
    this.editorAnnotationId = annotationId
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
      const locator = createWebviewElementLocator(this.editorElement)
      if (locator) annotation.element = locator
      this.annotationElements.set(annotation.id, this.editorElement)
    } else {
      const locator = createWebviewElementLocator(this.editorElement)
      if (!locator) return
      const annotation: WebviewAnnotation = {
        id: crypto.randomUUID(),
        comment,
        createdAt: Date.now(),
        element: locator
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
        const element = this.resolveAnnotationElement(annotation)
        if (element) this.openEditor(element, annotation.id)
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

    const highlightedElement = this.editorElement ?? this.highlightElement
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

    if (this.editor && this.editorElement?.isConnected) {
      const rect = this.editorElement.getBoundingClientRect()
      const editorRect = this.editor.getBoundingClientRect()
      const margin = 8
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - editorRect.width - margin)
      )
      const belowTop = rect.bottom + margin
      const top =
        belowTop + editorRect.height <= window.innerHeight - margin
          ? belowTop
          : Math.max(margin, rect.top - editorRect.height - margin)
      this.editor.style.left = `${left}px`
      this.editor.style.top = `${top}px`
    }
  }
}
