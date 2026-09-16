import remarkParse from 'remark-parse'
import { parseMarkdownIntoBlocks } from 'streamdown'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { remarkLatexMath } from './remarkLatexMath'

const parser = unified().use(remarkParse).use(remarkLatexMath).freeze()

export function parseLatexMarkdownBlocks(source: string): string[] {
  const blocks = parseMarkdownIntoBlocks(source)
  if (!source.includes('\\[')) return blocks

  const ranges: Array<{ start: number; end: number }> = []
  visit(parser.parse(blocks.join('')), 'math', (node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) ranges.push({ start, end })
  })

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
