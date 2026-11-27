import { type EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { isMac } from '@renderer/utils/platform'

import { isMarkdownFencedCodePosition } from './livePreviewPlugin'
import { createMarkdownSession, type MarkdownSession, TOKEN_PLACEHOLDER } from './markdownSession'

type Style = 'bold' | 'italic' | 'code'

/** Bold and italic share the emphasis nodes, so they nest and combine independently. */
const STYLE_NODES: Record<Style, string> = { bold: 'StrongEmphasis', italic: 'Emphasis', code: 'InlineCode' }
const SHORTCUT_STYLES: Record<string, Style> = { b: 'bold', i: 'italic' }
const LINE_PREFIX = /^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+)*/

/** A parsed span in line columns, with its delimiters in [from, contentFrom) and [contentTo, to). */
interface Span {
  name: string
  from: number
  to: number
  contentFrom: number
  contentTo: number
}

interface LineSegment {
  base: number
  text: string
  spans: Span[]
  start: number
  end: number
  /** The range of the spans that wrap exactly the selected text, or the text itself. */
  outerFrom: number
  outerTo: number
  styled?: Span
  container?: Span
}

interface Edit {
  from: number
  to: number
  text: string
}

function readSpans(session: MarkdownSession, line: number, style: Style): Span[] {
  const names = style === 'code' ? ['InlineCode'] : ['Emphasis', 'StrongEmphasis']
  const { textFrom, textTo } = session.lines[line]
  const spans: Span[] = []
  session.tree.iterate({
    from: textFrom,
    to: textTo,
    enter: ({ name, from, to, node }) => {
      if (!names.includes(name) || from < textFrom || to > textTo) return
      const marks = node.getChildren(name === 'InlineCode' ? 'CodeMark' : 'EmphasisMark')
      if (marks.length < 2) return
      let contentFrom = marks[0].to - textFrom
      let contentTo = marks[marks.length - 1].from - textFrom
      // CommonMark drops one space on each side of code that has other text.
      const content = session.text.slice(textFrom + contentFrom, textFrom + contentTo)
      if (name === 'InlineCode' && content.length > 2 && /^ [^]*\S[^]* $/.test(content)) {
        contentFrom += 1
        contentTo -= 1
      }
      spans.push({ name, from: from - textFrom, to: to - textFrom, contentFrom, contentTo })
    }
  })
  return spans
}

/** Moves selection edges out of delimiters and whitespace, so selecting `**a**` selects `a`. */
function snapToText(text: string, spans: readonly Span[], start: number, end: number) {
  for (let moved = true; moved && start < end;) {
    moved = false
    for (const span of spans) {
      const nextStart =
        start >= span.from && start < span.contentFrom
          ? span.contentFrom
          : start >= span.contentTo && start < span.to
            ? span.to
            : start
      const nextEnd =
        end > span.contentTo && end <= span.to
          ? span.contentTo
          : end > span.from && end <= span.contentFrom
            ? span.from
            : end
      moved ||= nextStart !== start || nextEnd !== end
      start = nextStart
      end = nextEnd
    }
    while (start < end && /\s/.test(text[start])) {
      start += 1
      moved = true
    }
    while (start < end && /\s/.test(text[end - 1])) {
      end -= 1
      moved = true
    }
  }
  return [start, end] as const
}

function readSegments(state: EditorState, style: Style) {
  const { from, to } = state.selection
  const segments: LineSegment[] = []
  const session = createMarkdownSession(state.doc)
  const styleName = STYLE_NODES[style]

  state.doc.nodesBetween(from, to, (node, position, _parent, index) => {
    if (!node.isTextblock) return true
    const base = position + 1
    if (isMarkdownFencedCodePosition(state, base)) return false

    const text = node.textBetween(0, node.content.size, undefined, TOKEN_PLACEHOLDER)
    const spans = readSpans(session, index, style)
    const selectedFrom = Math.max(from - base, LINE_PREFIX.exec(text)?.[0].length ?? 0)
    const selectedTo = Math.min(text.length, to - base)
    const [start, end] = snapToText(text, spans, selectedFrom, Math.max(selectedFrom, selectedTo))
    if (start >= end) return false

    // `***a***` wraps `a` twice; the outermost wrapper bounds where other delimiters may go.
    const wrappers: Span[] = []
    let outerFrom = start
    let outerTo = end
    for (;;) {
      const wrapper = spans.find((span) => span.contentFrom === outerFrom && span.contentTo === outerTo)
      if (!wrapper) break
      wrappers.push(wrapper)
      outerFrom = wrapper.from
      outerTo = wrapper.to
    }
    const styled = wrappers.find((span) => span.name === styleName)
    const container = styled
      ? undefined
      : spans.find((span) => span.name === styleName && span.contentFrom <= outerFrom && outerTo <= span.contentTo)
    segments.push({ base, text, spans, start, end, outerFrom, outerTo, styled, container })
    return false
  })

  return segments
}

/** Code delimiters are one backtick longer than any run inside, with a space where the code meets a backtick. */
function codeDelimiters(code: string) {
  const marker = '`'.repeat(Math.max(0, ...[...code.matchAll(/`+/g)].map(([run]) => run.length)) + 1)
  const padding = code.startsWith('`') || code.endsWith('`') ? ' ' : ''
  return { open: marker + padding, close: padding + marker }
}

function planEdits(segment: LineSegment, style: Style, removing: boolean, edits: Edit[]) {
  const { base, text, spans, start, end, outerFrom, outerTo, styled, container } = segment
  const remove = (from: number, to: number) => edits.push({ from: base + from, to: base + to, text: '' })
  const insert = (at: number, value: string) => edits.push({ from: base + at, to: base + at, text: value })
  const removeDelimiters = (span: Span) => {
    remove(span.from, span.contentFrom)
    remove(span.contentTo, span.to)
  }

  if (removing) {
    if (styled) removeDelimiters(styled)
    else if (container) {
      // Close the span before the selection and reopen it after; whitespace stays outside the delimiters.
      const before = text.slice(container.contentFrom, outerFrom)
      const after = text.slice(outerTo, container.contentTo)
      const closer = text.slice(container.contentTo, container.to).trim()
      const opener = text.slice(container.from, container.contentFrom).trim()
      if (before.trim()) insert(outerFrom - (before.length - before.trimEnd().length), closer)
      else remove(container.from, container.contentFrom)
      if (after.trim()) insert(outerTo + (after.length - after.trimStart().length), opener)
      else remove(container.contentTo, container.to)
    }
    return
  }
  if (styled || container) return

  // A span of the same style that the new one touches or overlaps merges into it.
  const merged = spans.filter(
    (span) => span.name === STYLE_NODES[style] && span.to >= outerFrom && span.from <= outerTo
  )
  const from = merged.length ? Math.min(outerFrom, ...merged.map((span) => span.contentFrom)) : start
  const to = merged.length ? Math.max(outerTo, ...merged.map((span) => span.contentTo)) : end
  merged.forEach(removeDelimiters)

  if (style !== 'code') {
    const marker = style === 'bold' ? '**' : '*'
    insert(from, marker)
    insert(to, marker)
    return
  }
  const isDelimiter = (column: number) =>
    merged.some(
      (span) => (column >= span.from && column < span.contentFrom) || (column >= span.contentTo && column < span.to)
    )
  const code = text
    .slice(from, to)
    .split('')
    .filter((_character, offset) => !isDelimiter(from + offset))
    .join('')
  const { open, close } = codeDelimiters(code)
  insert(from, open)
  insert(to, close)
}

function toggleStyle(view: EditorView, style: Style) {
  const { state } = view
  if (state.selection instanceof NodeSelection) return false
  const segments = readSegments(state, style)
  if (segments.length === 0) return false

  // As in a word processor, the style comes off only when every selected line already has it.
  const removing = segments.every(({ styled, container }) => styled || container)
  const edits: Edit[] = []
  segments.forEach((segment) => planEdits(segment, style, removing, edits))

  // Applied from the end so earlier positions stay valid; a deletion goes before an insertion at its start.
  const transaction = state.tr
  edits
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .forEach(({ from, to, text }) => (text ? transaction.insertText(text, from) : transaction.delete(from, to)))

  const first = segments[0]
  const last = segments[segments.length - 1]
  const selectionFrom = transaction.mapping.map(first.base + first.start, 1)
  const selectionTo = transaction.mapping.map(last.base + last.end, -1)
  view.dispatch(
    transaction.setSelection(TextSelection.create(transaction.doc, selectionFrom, selectionTo)).scrollIntoView()
  )
  return true
}

/** Toggles bold, italic, or inline code on the selected source; anything else keeps the key's existing meaning. */
export function handleMarkdownFormatKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing || event.altKey) return false
  // Handled before input: a typed backtick that matches the selection's edge reaches ProseMirror as a deletion.
  if (event.key === '`') return !event.metaKey && !event.ctrlKey && toggleStyle(view, 'code')

  const style = SHORTCUT_STYLES[event.key.toLowerCase()]
  const hasPrimaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!style || !hasPrimaryModifier || event.shiftKey) return false
  return toggleStyle(view, style)
}
