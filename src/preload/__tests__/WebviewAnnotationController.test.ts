import { WEBVIEW_ANNOTATION_LIMITS, type WebviewAnnotationState } from '@shared/types/webview'
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
  edit: 'Edit'
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
    openEditor: (element: Element, annotationId?: string | null) => void
    saveEditor: () => void
    deleteEditorAnnotation: () => void
    textarea: HTMLTextAreaElement
    updatePositions: () => void
  }

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
