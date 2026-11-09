import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { findMarkdownCodeLine } from './livePreviewPlugin'
import { TOKEN_PLACEHOLDER } from './markdownSession'

type CodeLineMatch = NonNullable<ReturnType<typeof findMarkdownCodeLine>>

const CODE_INDENT = '  '

function insertCodeNewline(view: EditorView, { block, line }: CodeLineMatch) {
  const { state } = view
  const { $from, empty } = state.selection
  const { paragraph } = state.schema.nodes
  const transaction = state.tr

  if (line === block.close && empty) {
    const below = line.blockPosition + line.blockSize
    transaction.insert(below, paragraph.create())
    view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, below + 1)).scrollIntoView())
    return
  }

  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, TOKEN_PLACEHOLDER)
  const isAtLineEnd = $from.parentOffset === $from.parent.content.size
  if (!empty) transaction.deleteSelection()
  transaction.split(transaction.selection.from)
  const nextLineStart = transaction.selection.from

  if (line === block.open) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(before)?.[1]
    if (fence && isAtLineEnd && !block.close && block.codeLines.length === 0) {
      transaction.insert(nextLineStart + 1, paragraph.create(null, state.schema.text(fence)))
      transaction.setSelection(TextSelection.create(transaction.doc, nextLineStart))
    }
  } else if (line !== block.close) {
    const indent = (/^[ \t]*/.exec(before)?.[0] ?? '') + (/[{[(]\s*$/.test(before) ? CODE_INDENT : '')
    if (indent) transaction.insertText(indent, nextLineStart)
  }
  view.dispatch(transaction.scrollIntoView())
}

function indentCodeSelection(view: EditorView, { block }: CodeLineMatch, outdent: boolean) {
  const { state } = view
  const { from, to, empty } = state.selection
  if (empty && !outdent) {
    view.dispatch(state.tr.insertText(CODE_INDENT, from).scrollIntoView())
    return
  }

  const lineStarts: number[] = []
  const lastLine = block.close ?? block.codeLines.at(-1) ?? block.open
  const blockEnd = lastLine.blockPosition + lastLine.blockSize
  state.doc.nodesBetween(from, Math.min(to, blockEnd), (node, position) => {
    if (!node.isTextblock) return true
    lineStarts.push(position + 1)
    return false
  })

  const transaction = state.tr
  lineStarts.reverse().forEach((start) => {
    if (!outdent) {
      transaction.insertText(CODE_INDENT, start)
      return
    }
    const leading = /^ */.exec(state.doc.resolve(start).parent.textContent)?.[0].length ?? 0
    const width = Math.min(CODE_INDENT.length, leading)
    if (width > 0) transaction.delete(start, start + width)
  })
  if (transaction.docChanged) view.dispatch(transaction.scrollIntoView())
}

/** Inside a fenced block every Enter combination is a newline and Tab indents; nothing sends. */
export function handleMarkdownCodeKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing) return false
  const isEnter = event.key === 'Enter' || event.key === 'NumpadEnter'
  if (!isEnter && event.key !== 'Tab') return false

  const match = findMarkdownCodeLine(view.state, view.state.selection.from)
  if (!match) return false

  if (isEnter) insertCodeNewline(view, match)
  else indentCodeSelection(view, match, event.shiftKey)
  return true
}
