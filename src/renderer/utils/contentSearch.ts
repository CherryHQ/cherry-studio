export interface TextSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
}

export interface TextSearchMatch {
  start: number
  end: number
}

const WORD_SEGMENTER = new Intl.Segmenter(['zh-CN', 'en-US'], { granularity: 'word' })

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findTextMatches(text: string, searchText: string, options: TextSearchOptions): TextSearchMatch[] {
  if (!searchText) return []

  const regex = new RegExp(escapeRegExp(searchText), options.caseSensitive ? 'gu' : 'giu')
  const matches = Array.from(text.matchAll(regex), (match) => ({
    start: match.index,
    end: match.index + match[0].length
  }))
  if (!options.wholeWord || matches.length === 0) return matches

  const wordStarts = new Set<number>()
  const wordEnds = new Set<number>()
  for (const segment of WORD_SEGMENTER.segment(text)) {
    if (!segment.isWordLike) continue
    wordStarts.add(segment.index)
    wordEnds.add(segment.index + segment.segment.length)
  }

  return matches.filter((match) => wordStarts.has(match.start) && wordEnds.has(match.end))
}

/**
 * Collect DOM ranges matching `searchText` under `root`. Text nodes are
 * concatenated before matching so matches spanning element boundaries remain searchable.
 */
export function findRangesInScope(
  root: HTMLElement,
  searchText: string,
  options: TextSearchOptions,
  filter: NodeFilter
): Range[] {
  const ranges: Range[] = []
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter)
  const allTextNodes: { node: Node; startOffset: number }[] = []
  let fullText = ''

  while (treeWalker.nextNode()) {
    allTextNodes.push({ node: treeWalker.currentNode, startOffset: fullText.length })
    fullText += treeWalker.currentNode.nodeValue
  }

  for (const match of findTextMatches(fullText, searchText, options)) {
    let startNode: Node | null = null
    let endNode: Node | null = null
    let startOffset = 0
    let endOffset = 0

    for (const nodeInfo of allTextNodes) {
      const nodeLength = nodeInfo.node.nodeValue?.length ?? 0
      if (
        startNode === null &&
        match.start >= nodeInfo.startOffset &&
        match.start < nodeInfo.startOffset + nodeLength
      ) {
        startNode = nodeInfo.node
        startOffset = match.start - nodeInfo.startOffset
      }
      if (match.end > nodeInfo.startOffset && match.end <= nodeInfo.startOffset + nodeLength) {
        endNode = nodeInfo.node
        endOffset = match.end - nodeInfo.startOffset
        break
      }
    }

    if (startNode && endNode) {
      const range = new Range()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      ranges.push(range)
    }
  }

  return ranges
}

export const supportsCustomHighlights = () =>
  typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight !== 'undefined'
