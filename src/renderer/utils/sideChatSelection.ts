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
  if (!span || span !== end?.closest('[data-side-chat-source]')) return null
  const source = span.dataset.sideChatSource
  if (!source || source !== span.textContent) return null
  const before = range.cloneRange()
  before.selectNodeContents(span)
  before.setEnd(range.startContainer, range.startOffset)
  const text = range.toString()
  const offset = before.toString().length
  return text && source.slice(offset, offset + text.length) === text ? { ...result, selection: text } : null
}
