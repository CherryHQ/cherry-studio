import { type EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isMac } from '@renderer/utils/platform'

import { isMarkdownFencedCodePosition } from './livePreviewPlugin'
import { TOKEN_PLACEHOLDER } from './markdownSession'

/** Marker width per key. An asterisk run reads as a style mask: 1 italic, 2 bold, 3 both. */
const MARKER_WIDTHS: Record<string, number> = { b: 2, i: 1 }
const LINE_PREFIX = /^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+)*/

interface Segment {
  from: number
  to: number
  stars: number
}

const hasStyle = (stars: number, width: number) => (stars & width) !== 0

function readSegments(state: EditorState) {
  const { from, to } = state.selection
  const segments: Segment[] = []

  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return true
    const base = position + 1
    if (isMarkdownFencedCodePosition(state, base)) return false

    const text = node.textBetween(0, node.content.size, undefined, TOKEN_PLACEHOLDER)
    const selectedFrom = Math.max(from - base, LINE_PREFIX.exec(text)?.[0].length ?? 0)
    const selected = text.slice(selectedFrom, Math.max(selectedFrom, to - base))
    let start = selectedFrom + selected.length - selected.trimStart().length
    let end = start + selected.trim().length
    if (start >= end) return false

    // Markers at the selection's edges stay outside the text, as on inner lines after a multi-line toggle.
    const edges = /^(\**)[^*]+(\**)$/.exec(text.slice(start, end))
    if (edges) {
      start += edges[1].length
      end -= edges[2].length
    }

    const starsBefore = /\**$/.exec(text.slice(0, start))?.[0].length ?? 0
    const starsAfter = /^\**/.exec(text.slice(end))?.[0].length ?? 0
    segments.push({ from: base + start, to: base + end, stars: Math.min(starsBefore, starsAfter, 3) })
    return false
  })

  return segments
}

/** Toggles bold or italic on the selected source; anything it cannot act on keeps the key's existing meaning. */
export function handleMarkdownFormatKey(view: EditorView, event: KeyboardEvent): boolean {
  const width = MARKER_WIDTHS[event.key.toLowerCase()]
  const hasPrimaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!width || !hasPrimaryModifier || event.shiftKey || event.altKey || event.isComposing) return false

  const { state } = view
  if (state.selection instanceof NodeSelection) return false
  const segments = readSegments(state)
  if (segments.length === 0) return false

  const marker = '*'.repeat(width)
  const removing = segments.every(({ stars }) => hasStyle(stars, width))
  const transaction = state.tr
  for (const { from, to, stars } of [...segments].reverse()) {
    if (removing) transaction.delete(to, to + width).delete(from - width, from)
    else if (!hasStyle(stars, width)) transaction.insertText(marker, to).insertText(marker, from)
  }

  const selectionFrom = transaction.mapping.map(segments[0].from, 1)
  const selectionTo = transaction.mapping.map(segments[segments.length - 1].to, -1)
  view.dispatch(
    transaction.setSelection(TextSelection.create(transaction.doc, selectionFrom, selectionTo)).scrollIntoView()
  )
  return true
}
