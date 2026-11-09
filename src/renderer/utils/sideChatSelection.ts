/** Require a renderer-attested source span; transformed and multi-span selections fail closed. */
export function readSideChatSelection(selection: Selection): { messageId: string; selection?: string } | null {
  if (selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const message = start?.closest<HTMLElement>('[data-side-chat-message]')
  if (!message || message !== end?.closest('[data-side-chat-message]')) return null
  const result = { messageId: message.dataset.sideChatMessage! }
  const span = start?.closest<HTMLElement>('[data-side-chat-source]')
  if (!span || span !== end?.closest('[data-side-chat-source]')) return result
  if (
    span.childNodes.length !== 1 ||
    span.firstChild !== range.startContainer ||
    span.firstChild !== range.endContainer
  )
    return result
  const source = span.dataset.sideChatSource
  if (!source || source !== span.textContent) return result
  const text = source.slice(range.startOffset, range.endOffset)
  return text ? { ...result, selection: text } : result
}
