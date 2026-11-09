import type { Tree } from '@lezer/common'
import { TreeFragment } from '@lezer/common'
import { GFM, parser } from '@lezer/markdown'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** A token atom occupies one document position, so it reads as one character of source. */
export const TOKEN_PLACEHOLDER = '\uFFFC'

const markdownParser = parser.configure(GFM)

export interface SourceLine {
  textFrom: number
  textTo: number
  blockPosition: number
  blockSize: number
}

/** The edited source window, in offsets of the previous and the next text. */
export interface SourceChange {
  from: number
  toOld: number
  toNew: number
}

export interface MarkdownSession {
  text: string
  lines: SourceLine[]
  tree: Tree
  fragments: readonly TreeFragment[]
  change: SourceChange | null
}

function readSource(doc: ProseMirrorNode) {
  const lines: SourceLine[] = []
  let text = ''

  doc.forEach((block, blockPosition) => {
    if (lines.length > 0) text += '\n'
    const textFrom = text.length
    block.forEach((child) => {
      if (child.isText) text += child.text ?? ''
      else text += child.type.name === 'hardBreak' ? '\n' : TOKEN_PLACEHOLDER
    })
    lines.push({ textFrom, textTo: text.length, blockPosition, blockSize: block.nodeSize })
  })

  return { text, lines }
}

function diffSource(previous: string, next: string): SourceChange | null {
  if (previous === next) return null

  const limit = Math.min(previous.length, next.length)
  let from = 0
  while (from < limit && previous.charCodeAt(from) === next.charCodeAt(from)) from += 1

  let suffix = 0
  while (
    suffix < limit - from &&
    previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1
  }

  return { from, toOld: previous.length - suffix, toNew: next.length - suffix }
}

/** Parses the document, reusing the previous session's tree outside the edited window. */
export function createMarkdownSession(doc: ProseMirrorNode, previous?: MarkdownSession): MarkdownSession {
  const { text, lines } = readSource(doc)
  const change = previous ? diffSource(previous.text, text) : null
  const reusable =
    previous && change
      ? TreeFragment.applyChanges(previous.fragments, [
          { fromA: change.from, toA: change.toOld, fromB: change.from, toB: change.toNew }
        ])
      : previous?.fragments
  const tree = previous && !change ? previous.tree : markdownParser.parse(text, reusable)

  return { text, lines, tree, fragments: TreeFragment.addTree(tree, reusable), change }
}

export function findSourceLineIndex(lines: readonly SourceLine[], offset: number) {
  let low = 0
  let high = lines.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (lines[middle].textFrom <= offset) low = middle
    else high = middle - 1
  }
  return low
}

export function toDocumentPosition(lines: readonly SourceLine[], offset: number) {
  const line = lines[findSourceLineIndex(lines, offset)]
  return line.blockPosition + 1 + (offset - line.textFrom)
}
