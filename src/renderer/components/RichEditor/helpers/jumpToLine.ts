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
 * Resolve the block element a jump-to-line target points at. The native @tiptap/markdown (marked)
 * AST has no per-node line numbers, so this is best-effort and combines both available signals:
 * 1. Content match — normalize the source line and find the top-level block(s) whose text contains it.
 *    When the same text appears in several blocks, pick the one nearest the estimated line position so
 *    duplicate lines don't always resolve to the first occurrence.
 * 2. Proportional fallback — when nothing matches (e.g. a table separator or fence with no rendered
 *    text), map `lineNumber / totalLines` onto the block list.
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

  // Proportional estimate of where lineNumber lands in the block list (best-effort; marked has no
  // line numbers). Used both to disambiguate duplicate text matches and as a last-resort fallback.
  const estimatedIndex =
    totalLines && totalLines > 0
      ? Math.min(blocks.length - 1, Math.max(0, Math.floor(((lineNumber - 1) / totalLines) * blocks.length)))
      : null

  // Strategy 1: content match, disambiguated by proximity to the estimated line position.
  const needle = lineContent ? normalizeMarkdownLine(lineContent) : ''
  if (needle) {
    const matches: { block: HTMLElement; index: number }[] = []
    blocks.forEach((block, index) => {
      if (block.textContent?.replace(/\s+/g, ' ').includes(needle)) matches.push({ block, index })
    })
    if (matches.length === 1) return matches[0].block
    if (matches.length > 1) {
      if (estimatedIndex === null) return matches[0].block
      return matches.reduce((best, cur) =>
        Math.abs(cur.index - estimatedIndex) < Math.abs(best.index - estimatedIndex) ? cur : best
      ).block
    }
  }

  // Strategy 2: proportional fallback.
  return estimatedIndex === null ? null : blocks[estimatedIndex]
}
