function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  const tagName = element.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true
  return element.isContentEditable || element.getAttribute('contenteditable') === 'true'
}

function isWithinEditable(element: HTMLElement, stopAt: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (isEditableElement(node)) return true
    if (node === stopAt) return false
    node = node.parentElement
  }
  return false
}

/** Hidden, `aria-hidden`, `inert`, or CSS-hidden, including ancestors. */
export function isElementSuppressed(element: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return true
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    node = node.parentElement
  }
  return false
}

function isBlockingSurfaceOpen(): boolean {
  const nodes = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"]')
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.getAttribute('data-state') === 'closed') continue
    if (isElementSuppressed(node)) continue
    return true
  }
  return false
}

/**
 * True when `element` is on screen, holds focus, that focus is not an editable
 * descendant, and no dialog or menu is open.
 */
export function canRunFocusedResourceCommand(element: HTMLElement | null): boolean {
  if (!(element instanceof HTMLElement) || !element.isConnected || isElementSuppressed(element)) return false
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !element.contains(active) || isWithinEditable(active, element)) {
    return false
  }
  return !isBlockingSurfaceOpen()
}
