import remarkParse from 'remark-parse'
import { parseMarkdownIntoBlocks } from 'streamdown'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { remarkLatexMath } from './remarkLatexMath'

const parser = unified().use(remarkParse).use(remarkLatexMath).freeze()

export function createLatexMarkdownBlockParser(): (source: string) => string[] {
  let cachedSource = ''
  let ranges: Array<{ start: number; end: number }> = []

  return (source) => {
    const blocks = parseMarkdownIntoBlocks(source)
    if (!source.includes('\\[')) return blocks

    const normalized = blocks.join('')
    const closing = normalized.lastIndexOf('\\]')
    if (closing < 0) return blocks
    const lineEnd = normalized.indexOf('\n', closing)
    const mathSource = normalized.slice(0, lineEnd < 0 ? undefined : lineEnd + 1)

    // Later prose cannot change a closed formula; retain one result per message.
    if (mathSource !== cachedSource) {
      cachedSource = mathSource
      ranges = []
      visit(parser.parse(mathSource), 'math', (node) => {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start !== undefined && end !== undefined) ranges.push({ start, end })
      })
    }

    const result: string[] = []
    let offset = 0
    let rangeIndex = 0
    let pending = ''
    for (const block of blocks) {
      pending += block
      offset += block.length
      while (ranges[rangeIndex] && ranges[rangeIndex].end <= offset) rangeIndex += 1
      if (ranges[rangeIndex] && ranges[rangeIndex].start < offset) continue
      result.push(pending)
      pending = ''
    }
    if (pending) result.push(pending)
    return result
  }
}
