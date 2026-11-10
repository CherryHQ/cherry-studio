/** Bind the rendered selection to its answer; source anchoring is resolved separately. */
export function readSideChatSelection(
  selection: Selection,
  selectedText?: string
): { messageId: string; selection?: string } | null {
  if (selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const message = start?.closest<HTMLElement>('[data-side-chat-message]')
  if (!message || message !== end?.closest('[data-side-chat-message]')) return null
  const excluded =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], button:not([data-side-chat-entry])'
  if (start?.closest(excluded) || end?.closest(excluded)) return null
  const result = { messageId: message.dataset.sideChatMessage! }
  const code = start?.closest<HTMLElement>('[data-side-chat-code]')
  if (code && code === end?.closest('[data-side-chat-code]')) {
    const source = code.dataset.sideChatCode!
    const lines = source.split('\n')
    const point = (node: Node, offset: number) => {
      const element = node instanceof Element ? node : node.parentElement
      const content = element?.closest('.line-content')
      const row = content?.closest<HTMLElement>('[data-index]')
      if (!content || !row || !code.contains(row)) return null
      const line = Number(row.dataset.index)
      if (!Number.isInteger(line) || lines[line] !== content.textContent) return null
      const before = document.createRange()
      before.selectNodeContents(content)
      before.setEnd(node, offset)
      return lines.slice(0, line).reduce((sum, value) => sum + value.length + 1, 0) + before.toString().length
    }
    const from = point(range.startContainer, range.startOffset)
    const to = point(range.endContainer, range.endOffset)
    if (from !== null && to !== null && from < to) return { ...result, selection: source.slice(from, to) }
  }
  const text = selectedText ?? selection.toString()
  return text.trim() ? { ...result, selection: text } : null
}
