/**
 * Custom KaTeX copy handler that respects partial text selections.
 *
 * When the user selects part of a KaTeX formula and copies, this handler
 * lets the browser perform normal text copy (so the selected text is copied).
 * Only when the selection fully encompasses one or more KaTeX elements does
 * it replace them with their LaTeX source.
 *
 * Replaces the default `katex/dist/contrib/copy-tex` behavior.
 */

function isKatexElement(el: Element | null): boolean {
  return el != null && (el.classList.contains('katex') || el.classList.contains('katex-display'))
}

function getClosestKatex(el: Node | null): Element | null {
  let current: Node | null = el
  while (current != null) {
    if (current.nodeType === Node.ELEMENT_NODE && isKatexElement(current as Element)) {
      return current as Element
    }
    current = current.parentNode
  }
  return null
}

function extractLatex(katexEl: Element): string {
  // Try data-latex attribute first (set by some renderers)
  const dataLatex = katexEl.getAttribute('data-latex')
  if (dataLatex) return dataLatex

  // Try to find the annotation with the tex source (rendered by KaTeX)
  const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]')
  if (annotation) return annotation.textContent || ''

  return ''
}

function handleKatexCopy(event: ClipboardEvent): void {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return

  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer

  // Find the closest KaTeX element to the selection
  const katexEl = getClosestKatex(container.nodeType === Node.TEXT_NODE ? container.parentNode : container)

  if (!katexEl) return

  // Check if the selection covers the ENTIRE KaTeX element
  // If the selection only partially covers the formula, let normal copy proceed
  const katexRange = document.createRange()
  katexRange.selectNodeContents(katexEl)

  // Selection fully covers katex element -> replace with LaTeX
  if (
    range.compareBoundaryPoints(Range.START_TO_START, katexRange) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, katexRange) >= 0
  ) {
    const latex = extractLatex(katexEl)
    if (latex) {
      event.preventDefault()
      event.clipboardData?.setData('text/plain', latex)
    }
    return
  }

  // Partial selection - do nothing, let the browser copy the selected text
}

// Register the handler once when this module is imported
if (typeof document !== 'undefined') {
  document.addEventListener('copy', handleKatexCopy)
}
