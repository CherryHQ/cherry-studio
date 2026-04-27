function closestKatex(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.katex') ?? null
}

function isSelectionFullyWithinSingleKatex(selection: Selection): boolean {
  if (selection.isCollapsed || selection.rangeCount === 0) {
    return false
  }

  const range = selection.getRangeAt(0)
  const startContainer = range.startContainer
  const endContainer = range.endContainer

  const startKatex = closestKatex(startContainer)
  const endKatex = closestKatex(endContainer)

  if (!startKatex || !endKatex) {
    return false
  }

  if (startKatex !== endKatex) {
    return false
  }

  const katexElement = startKatex

  const rangeStartInside = katexElement.contains(startContainer)
  const rangeEndInside = katexElement.contains(endContainer)

  return rangeStartInside && rangeEndInside
}

function handleKatexCopy(event: Event) {
  const clipboardEvent = event as ClipboardEvent
  const selection = window.getSelection()

  if (!selection || selection.isCollapsed || !clipboardEvent.clipboardData) {
    return
  }

  if (!isSelectionFullyWithinSingleKatex(selection)) {
    return
  }

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()

  const hasKatexMathml = fragment.querySelector('.katex-mathml')

  if (!hasKatexMathml) {
    return
  }

  const htmlContents = Array.prototype.map
    .call(fragment.childNodes, (el) => (el instanceof Text ? el.textContent : el.outerHTML))
    .join('')

  clipboardEvent.clipboardData.setData('text/html', htmlContents)

  const pre = document.createElement('pre')
  pre.appendChild(fragment)
  const plainText = pre.textContent || ''

  clipboardEvent.clipboardData.setData('text/plain', plainText)

  event.preventDefault()
}

export function initKatexCopyHandler(): () => void {
  const handleKatexCopyBound = handleKatexCopy

  if ((document as any).katexCopyHandlerActive) {
    return () => {}
  }

  ;(document as any).katexCopyHandlerActive = true
  document.addEventListener('copy', handleKatexCopyBound, true)

  return () => {
    document.removeEventListener('copy', handleKatexCopyBound, true)
    ;(document as any).katexCopyHandlerActive = false
  }
}
