import type { ClipboardEvent } from 'react'

export function copyComposedParagraphs(event: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection()
  if (event.defaultPrevented || !selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0).cloneRange()
  if (!event.currentTarget.contains(range.startContainer) || !event.currentTarget.contains(range.endContainer)) return
  if (
    ![...event.currentTarget.querySelectorAll('[data-paragraph-layout="composed"]')].some((node) =>
      range.intersectsNode(node)
    )
  )
    return
  const closestMath = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.katex')
  const startMath = closestMath(range.startContainer)
  const endMath = closestMath(range.endContainer)
  if (startMath) range.setStartBefore(startMath)
  if (endMath) range.setEndAfter(endMath)
  const fragment = range.cloneContents()
  for (const node of fragment.querySelectorAll('[data-paragraph-piece], [data-paragraph-run]'))
    node.replaceWith(...node.childNodes)
  for (const node of fragment.querySelectorAll('[data-paragraph-layout]')) node.removeAttribute('data-paragraph-layout')
  const container = document.createElement('div')
  container.append(fragment)
  event.clipboardData.setData('text/html', container.innerHTML)
  // Match copy-tex's delimiters while keeping block separators in mixed prose/math selections.
  for (const math of container.querySelectorAll('.katex')) {
    const source = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (source !== undefined && source !== null) {
      const delimiter = math.closest('.katex-display') ? '$$' : '$'
      math.replaceWith(document.createTextNode(`${delimiter}${source}${delimiter}`))
    }
  }
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, { position: 'fixed', left: '-100000px', whiteSpace: 'normal' })
  document.body.append(container)
  event.clipboardData.setData('text/plain', container.innerText)
  container.remove()
  event.preventDefault()
  // This selection is fully serialized here; the document-level copy-tex handler must not overwrite it.
  event.stopPropagation()
}
