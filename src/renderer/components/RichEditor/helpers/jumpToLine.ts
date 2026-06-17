import { loggerService } from '@logger'

const logger = loggerService.withContext('RichEditor/jumpToLine')

/**
 * Strip markdown syntax from a raw source line so it can be matched against a rendered block's
 * `textContent`. The native @tiptap/markdown (marked) AST exposes no per-node line numbers, so
 * jump-to-line resolves a search hit by its text rather than by line number.
 */
export function normalizeMarkdownLine(line: string): string {
  return (
    line
      // leading block markers: blockquote (>), heading (#), ordered list, list bullet + optional task checkbox
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
      // links / images -> visible text: [text](url) and ![alt](url)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // inline emphasis / code / strike markers
      .replace(/(\*\*|__|~~|[*_`])/g, '')
      // table pipes
      .replace(/\|/g, ' ')
      // collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Resolve the block element a jump-to-line target points at.
 * 1. Content match — normalize the source line and find the first top-level block whose text contains it.
 * 2. Proportional fallback — map `lineNumber / totalLines` onto the top-level block list.
 * Returns null only when the editor has no blocks.
 */
export function findElementByLine(
  editorDom: HTMLElement,
  lineNumber: number,
  lineContent?: string,
  totalLines?: number
): HTMLElement | null {
  const blocks = Array.from(editorDom.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
  if (blocks.length === 0) {
    logger.warn('No editor blocks found for jump-to-line')
    return null
  }

  // Strategy 1: content match against the rendered text of a top-level block.
  const needle = lineContent ? normalizeMarkdownLine(lineContent) : ''
  if (needle) {
    const match = blocks.find((block) => block.textContent?.replace(/\s+/g, ' ').includes(needle))
    if (match) return match
  }

  // Strategy 2: proportional estimate (best-effort; marked has no line numbers).
  if (totalLines && totalLines > 0) {
    const ratio = (lineNumber - 1) / totalLines
    const index = Math.min(blocks.length - 1, Math.max(0, Math.floor(ratio * blocks.length)))
    return blocks[index]
  }

  return null
}
