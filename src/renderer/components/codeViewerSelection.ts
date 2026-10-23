export type CodeViewerBoundarySide = 'start' | 'end'

export interface CodeViewerBoundary {
  line: number
  offset: number
  /** 'line' identifies a position within a row; 'container' clamps a container boundary to rendered rows. */
  source: 'line' | 'container'
}

export interface CodeViewerSavedSelection {
  startLine: number
  startOffset: number
  endLine: number
  endOffset: number
}

export function mergeCodeViewerSelection(
  previous: CodeViewerSavedSelection | null,
  start: CodeViewerBoundary,
  end: CodeViewerBoundary,
  allowReplace: boolean
): CodeViewerSavedSelection {
  return {
    startLine: !previous || (start.source === 'line' && allowReplace) ? start.line : previous.startLine,
    startOffset: !previous || (start.source === 'line' && allowReplace) ? start.offset : previous.startOffset,
    endLine: !previous || (end.source === 'line' && allowReplace) ? end.line : previous.endLine,
    endOffset: !previous || (end.source === 'line' && allowReplace) ? end.offset : previous.endOffset
  }
}

/** Both sides currently use the same DOM-order rule; the side parameter reserves directional handling. */
export function resolveCodeViewerBoundary(
  scroller: HTMLElement,
  node: Node,
  offset: number,
  side: CodeViewerBoundarySide
): CodeViewerBoundary | null {
  void side
  if (!scroller.contains(node)) return null

  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const row = element?.closest<HTMLElement>('[data-index]')
  const document = scroller.ownerDocument
  if (row && scroller.contains(row)) {
    const content = row.querySelector('.line-content') ?? row
    const lineLength = content.textContent?.length ?? 0
    const line = Number(row.dataset.index)
    let charOffset = 0

    if (element?.closest('.line-number')) {
      return { line, offset: 0, source: 'line' }
    }

    if (node.nodeType === Node.TEXT_NODE && content.contains(node)) {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      let current: Node | null
      while ((current = walker.nextNode())) {
        if (current === node) {
          charOffset += offset
          break
        }
        charOffset += current.textContent?.length ?? 0
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const childOffset = Math.max(0, Math.min(offset, node.childNodes.length))
      if (content.contains(node)) {
        const range = document.createRange()
        range.setStart(content, 0)
        range.setEnd(node, childOffset)
        charOffset = range.toString().length
      } else if (node.contains(content)) {
        let child: Node = content
        while (child.parentNode !== node) child = child.parentNode!
        const contentIndex = Array.from(node.childNodes).indexOf(child as ChildNode)
        charOffset = childOffset <= contentIndex ? 0 : lineLength
      }
    }

    return { line, offset: Math.max(0, Math.min(charOffset, lineLength)), source: 'line' }
  }

  const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]'))
  const childOffset = Math.max(0, Math.min(offset, node.childNodes.length))
  for (const renderedRow of rows) {
    const range = document.createRange()
    range.selectNode(renderedRow)
    // comparePoint includes both endpoints; only the row start owns a shared gap.
    range.collapse(true)
    if (range.comparePoint(node, childOffset) !== 1) {
      return { line: Number(renderedRow.dataset.index), offset: 0, source: 'container' }
    }
  }

  const lastRow = rows.at(-1)
  if (!lastRow) return null
  const content = lastRow.querySelector('.line-content') ?? lastRow
  return { line: Number(lastRow.dataset.index), offset: content.textContent?.length ?? 0, source: 'container' }
}
