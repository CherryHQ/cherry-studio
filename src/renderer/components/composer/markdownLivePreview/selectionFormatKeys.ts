import { type EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isMac } from '@renderer/utils/platform'

import { isMarkdownFencedCodePosition } from './livePreviewPlugin'
import { createMarkdownSession, TOKEN_PLACEHOLDER } from './markdownSession'

/** Marker width per key. An asterisk run reads as a style mask: 1 italic, 2 bold, 3 both. */
const MARKER_WIDTHS: Record<string, number> = { b: 2, i: 1 }
const MARKER_RUNS = {
  '*': /^\*+|\*+$/g,
  '`': /^`+|`+$/g
}
const LINE_PREFIX = /^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+)*/

interface Segment {
  from: number
  to: number
  run: number
  padding: number
}

const hasStyle = (run: number, width: number) => (run & width) !== 0

function readSegments(state: EditorState, character: keyof typeof MARKER_RUNS) {
  const { from, to } = state.selection
  const segments: Segment[] = []
  const session = createMarkdownSession(state.doc)

  state.doc.nodesBetween(from, to, (node, position, _parent, index) => {
    if (!node.isTextblock) return true
    const base = position + 1
    if (isMarkdownFencedCodePosition(state, base)) return false

    const text = node.textBetween(0, node.content.size, undefined, TOKEN_PLACEHOLDER)
    const selectedFrom = Math.max(from - base, LINE_PREFIX.exec(text)?.[0].length ?? 0)
    const selected = text.slice(selectedFrom, Math.max(selectedFrom, to - base))
    let start = selectedFrom + selected.length - selected.trimStart().length
    let end = start + selected.trim().length
    if (start >= end) return false

    let run = 0
    let padding = 0
    const offset = session.lines[index].textFrom
    session.tree.iterate({
      from: offset + start,
      to: offset + end,
      enter: ({ node: syntax }) => {
        const isStyle =
          character === '`'
            ? syntax.name === 'InlineCode'
            : syntax.name === 'Emphasis' || syntax.name === 'StrongEmphasis'
        if (!isStyle || run > 0) return
        const marked = session.text.slice(syntax.from, syntax.to)
        const edges = marked.match(MARKER_RUNS[character])
        if (edges?.length !== 2) return
        const width = Math.min(edges[0].length, edges[1].length, character === '*' ? 3 : Infinity)
        const inner = marked.slice(width, -width)
        const pad = character === '`' && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() ? 1 : 0
        const contentFrom = syntax.from - offset + width + pad
        const contentTo = syntax.to - offset - width - pad
        if (start < syntax.from - offset || start > contentFrom || end < contentTo || end > syntax.to - offset) return
        start = contentFrom
        end = contentTo
        run = width
        padding = pad
      }
    })
    segments.push({ from: base + start, to: base + end, run, padding })
    return false
  })

  return segments
}

function toggleMarker(view: EditorView, character: keyof typeof MARKER_RUNS, width: number) {
  const { state } = view
  if (state.selection instanceof NodeSelection) return false
  const segments = readSegments(state, character)
  if (segments.length === 0) return false

  const isStyled = (run: number) => (character === '`' ? run > 0 : hasStyle(run, width))
  const removing = segments.every(({ run }) => isStyled(run))
  const transaction = state.tr
  for (const { from, to, run, padding } of [...segments].reverse()) {
    if (removing) {
      const removeWidth = character === '`' ? run + padding : width
      transaction.delete(to, to + removeWidth).delete(from - removeWidth, from)
    } else if (!isStyled(run)) {
      const text = state.doc.textBetween(from, to, undefined, TOKEN_PLACEHOLDER)
      const codeWidth = Math.max(0, ...[...text.matchAll(/`+/g)].map(([match]) => match.length)) + 1
      const marker = character.repeat(character === '`' ? codeWidth : width)
      const pad = character === '`' && (text.startsWith('`') || text.endsWith('`')) ? ' ' : ''
      transaction.insertText(pad + marker, to).insertText(marker + pad, from)
    }
  }

  const selectionFrom = transaction.mapping.map(segments[0].from, 1)
  const selectionTo = transaction.mapping.map(segments[segments.length - 1].to, -1)
  view.dispatch(
    transaction.setSelection(TextSelection.create(transaction.doc, selectionFrom, selectionTo)).scrollIntoView()
  )
  return true
}

/** Toggles bold, italic, or inline code on the selected source; anything else keeps the key's existing meaning. */
export function handleMarkdownFormatKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || event.altKey) return false
  // Handled before input: a typed backtick that matches the selection's edge reaches ProseMirror as a deletion.
  if (event.key === '`') return !event.metaKey && !event.ctrlKey && toggleMarker(view, '`', 1)

  const width = MARKER_WIDTHS[event.key.toLowerCase()]
  const hasPrimaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!width || !hasPrimaryModifier || event.shiftKey) return false
  return toggleMarker(view, '*', width)
}
