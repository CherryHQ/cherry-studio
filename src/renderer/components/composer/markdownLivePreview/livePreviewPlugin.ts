import type { SyntaxNode } from '@lezer/common'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, type Selection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import {
  createMarkdownSession,
  findSourceLineIndex,
  type MarkdownSession,
  type SourceLine,
  toDocumentPosition,
  TOKEN_PLACEHOLDER
} from './markdownSession'

type Range = { from: number; to: number }
type Span = Range & { className: string }
/** `collapsesLine` removes the whole line while the marker is hidden, so it leaves no blank row. */
type Marker = Range & { reveal: Range; collapsesLine?: boolean }

/** Spans and markers are line-relative, so an untouched line compares equal after an edit above it. */
interface LineMarkup {
  spans: Span[]
  markers: Marker[]
  blockClasses: string[]
}

interface LivePreviewState {
  session: MarkdownSession
  markup: LineMarkup[]
  keys: string[]
  decorations: DecorationSet
  /** Set while composition edits the document without a matching parse. */
  stale: boolean
}

const livePreviewKey = new PluginKey<LivePreviewState>('composerMarkdownLivePreview')

const HEADING_NODE = /^ATXHeading([1-6])$/
const SETEXT_HEADING_NODE = /^SetextHeading([12])$/
const DELIMITED_NODES: Record<string, { mark: string; className: string }> = {
  Emphasis: { mark: 'EmphasisMark', className: 'composer-md-emphasis' },
  StrongEmphasis: { mark: 'EmphasisMark', className: 'composer-md-strong' },
  Strikethrough: { mark: 'StrikethroughMark', className: 'composer-md-delete' },
  InlineCode: { mark: 'CodeMark', className: 'composer-md-inline-code' }
}
const LITERAL_NODES = new Set(['Image', 'Table', 'HTMLBlock', 'HTMLTag', 'FencedCode', 'CodeBlock'])

const COMPOSITION_END_SETTLE_MS = 40

const SYNTAX_CLASS = 'composer-md-syntax'
const HIDDEN_SYNTAX_CLASS = `${SYNTAX_CLASS} composer-md-syntax-hidden`

function collectMarkup({ text, lines, tree }: MarkdownSession): LineMarkup[] {
  const markup = lines.map<LineMarkup>(() => ({ spans: [], markers: [], blockClasses: [] }))
  const documentRange = (range: Range) => ({
    from: toDocumentPosition(lines, range.from),
    to: toDocumentPosition(lines, range.to)
  })

  /** Calls `visit` with the part of the range on each source line it crosses. */
  const forEachLineSlice = (from: number, to: number, visit: (lineIndex: number, slice: Range) => void) => {
    const last = findSourceLineIndex(lines, to)
    for (let index = findSourceLineIndex(lines, from); index <= last; index += 1) {
      const { textFrom, textTo } = lines[index]
      const sliceFrom = Math.max(from, textFrom)
      const sliceTo = Math.min(to, textTo)
      if (sliceTo > sliceFrom) visit(index, { from: sliceFrom - textFrom, to: sliceTo - textFrom })
    }
  }
  const addSpan = (from: number, to: number, className: string) => {
    forEachLineSlice(from, to, (index, slice) => {
      // An inline decoration lands on an atom's own element, so spans stop short of token chips.
      const { textFrom } = lines[index]
      let start = slice.from
      for (let column = slice.from; column <= slice.to; column += 1) {
        if (column < slice.to && text[textFrom + column] !== TOKEN_PLACEHOLDER) continue
        if (column > start) markup[index].spans.push({ from: start, to: column, className })
        start = column + 1
      }
    })
  }
  const addMarker = (from: number, to: number, reveal: Range, options?: Pick<Marker, 'collapsesLine'>) => {
    const documentReveal = documentRange(reveal)
    forEachLineSlice(from, to, (index, slice) =>
      markup[index].markers.push({ ...slice, ...options, reveal: documentReveal })
    )
  }
  const addDelimited = (node: SyntaxNode, markName: string, className: string) => {
    const marks = node.getChildren(markName)
    if (marks.length < 2) return
    const open = marks[0]
    const close = marks[marks.length - 1]
    addMarker(open.from, open.to, node)
    addMarker(close.from, close.to, node)
    addSpan(open.to, close.from, className)
  }
  const addLink = (node: SyntaxNode) => {
    const marks = node.getChildren('LinkMark')
    // Only an inline link has a destination; `[0]` is a shortcut reference the parser cannot rule out.
    if (marks.length < 2 || !node.getChild('URL')) return
    addMarker(node.from, marks[0].to, node)
    addMarker(marks[1].from, node.to, node)
    addSpan(marks[0].to, marks[1].from, 'composer-md-link')
  }
  const addAtxHeading = (node: SyntaxNode, level: string) => {
    addSpan(node.from, node.to, `composer-md-heading composer-md-heading-${level}`)
    const mark = node.firstChild
    if (mark?.name !== 'HeaderMark') return
    const end = mark.to + (/^[ \t]*/.exec(text.slice(mark.to, node.to))?.[0].length ?? 0)
    addMarker(mark.from, end, node)
  }
  const addQuote = (node: SyntaxNode) => {
    const first = findSourceLineIndex(lines, node.from)
    const last = findSourceLineIndex(lines, node.to)
    for (let index = first; index <= last; index += 1) {
      const { textFrom, textTo } = lines[index]
      addSpan(textFrom, textTo, 'composer-md-quote')
      markup[index].blockClasses.push('composer-md-quote-line')
    }
  }
  const addHorizontalRule = (node: SyntaxNode) => {
    const index = findSourceLineIndex(lines, node.from)
    addMarker(node.from, node.to, { from: lines[index].textFrom, to: lines[index].textTo })
    markup[index].blockClasses.push('composer-md-horizontal-rule')
  }
  const addQuoteMark = (node: SyntaxNode) => {
    const line = lines[findSourceLineIndex(lines, node.from)]
    addMarker(node.from, node.to + (text[node.to] === ' ' ? 1 : 0), { from: line.textFrom, to: line.textTo })
  }

  tree.iterate({
    enter: (ref) => {
      const { name } = ref
      if (LITERAL_NODES.has(name)) return false

      const delimited = DELIMITED_NODES[name]
      if (delimited) addDelimited(ref.node, delimited.mark, delimited.className)
      else if (name === 'Link') addLink(ref.node)
      else if (name === 'Blockquote') addQuote(ref.node)
      else if (name === 'QuoteMark') addQuoteMark(ref.node)
      else if (name === 'HorizontalRule') addHorizontalRule(ref.node)
      else if (name === 'ListMark') addSpan(ref.from, ref.to, 'composer-md-list-marker')
      else if (name === 'ListItem')
        markup[findSourceLineIndex(lines, ref.from)].blockClasses.push('composer-md-list-line')
      else {
        const atxLevel = HEADING_NODE.exec(name)?.[1]
        const setextLevel = SETEXT_HEADING_NODE.exec(name)?.[1]
        if (atxLevel) addAtxHeading(ref.node, atxLevel)
        else if (setextLevel) {
          const underline = ref.node.getChild('HeaderMark')
          if (underline) {
            addSpan(ref.from, underline.from - 1, `composer-md-heading composer-md-heading-${setextLevel}`)
            addMarker(underline.from, underline.to, ref.node, { collapsesLine: true })
          }
        }
      }
      return true
    }
  })

  return markup
}

const isRevealed = (marker: Marker, selection: Selection) =>
  selection.from <= marker.reveal.to && selection.to >= marker.reveal.from

function lineKey({ spans, markers, blockClasses }: LineMarkup, selection: Selection) {
  if (spans.length === 0 && markers.length === 0 && blockClasses.length === 0) return ''
  const spanKey = spans.map((span) => `${span.from}-${span.to}:${span.className}`).join()
  const markerKey = markers.map((marker) => `${marker.from}-${marker.to}:${+isRevealed(marker, selection)}`).join()
  return `${spanKey}|${markerKey}|${blockClasses.join()}`
}

function renderLine(line: SourceLine, markup: LineMarkup, selection: Selection): Decoration[] {
  const base = line.blockPosition + 1
  const inline = (range: Range, className: string) =>
    Decoration.inline(base + range.from, base + range.to, { class: className })
  const isCollapsed = markup.markers.some((marker) => marker.collapsesLine && !isRevealed(marker, selection))
  const blockClasses = isCollapsed ? [...markup.blockClasses, 'composer-md-line-hidden'] : markup.blockClasses

  return [
    ...markup.spans.map((span) => inline(span, span.className)),
    ...markup.markers.map((marker) =>
      inline(marker, isRevealed(marker, selection) ? SYNTAX_CLASS : HIDDEN_SYNTAX_CLASS)
    ),
    ...(blockClasses.length > 0
      ? [
          Decoration.node(line.blockPosition, line.blockPosition + line.blockSize, {
            class: blockClasses.join(' ')
          })
        ]
      : [])
  ]
}

function findLineAtPosition(lines: readonly SourceLine[], position: number) {
  let low = 0
  let high = lines.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (lines[middle].blockPosition <= position) low = middle
    else high = middle - 1
  }
  return low
}

function decorationsOnLine(decorations: DecorationSet, line: SourceLine) {
  const end = line.blockPosition + line.blockSize
  return decorations.find(line.blockPosition, end).filter((item) => item.from >= line.blockPosition && item.to <= end)
}

function createPreviewState(doc: ProseMirrorNode, selection: Selection, previous?: MarkdownSession): LivePreviewState {
  const session = createMarkdownSession(doc, previous)
  const markup = collectMarkup(session)
  return {
    session,
    markup,
    keys: markup.map((line) => lineKey(line, selection)),
    decorations: DecorationSet.create(
      doc,
      session.lines.flatMap((line, index) => renderLine(line, markup[index], selection))
    ),
    stale: false
  }
}

function updateReveal(previous: LivePreviewState, doc: ProseMirrorNode, selection: Selection): LivePreviewState {
  const { session, markup } = previous
  const keys = [...previous.keys]
  const removed: Decoration[] = []
  const added: Decoration[] = []

  markup.forEach((line, index) => {
    if (line.markers.length === 0) return
    const key = lineKey(line, selection)
    if (key === keys[index]) return
    keys[index] = key
    removed.push(...decorationsOnLine(previous.decorations, session.lines[index]))
    added.push(...renderLine(session.lines[index], line, selection))
  })

  if (added.length === 0 && removed.length === 0) return previous
  return { ...previous, keys, decorations: previous.decorations.remove(removed).add(doc, added) }
}

function updateDocument(previous: LivePreviewState, transaction: Transaction, state: EditorState): LivePreviewState {
  const ranges = getChangedRanges(transaction)
  if (ranges.length === 0) return createPreviewState(state.doc, state.selection, previous.session)

  // Steps, not the text diff, bound the edit: a replaced line with equal text loses its decorations.
  const session = createMarkdownSession(state.doc, previous.session)
  const previousLines = previous.session.lines
  const firstChanged = findLineAtPosition(previousLines, Math.min(...ranges.map(({ oldRange }) => oldRange.from)))
  const lastChangedOld = findLineAtPosition(previousLines, Math.max(...ranges.map(({ oldRange }) => oldRange.to)))
  const lastChangedNew = findLineAtPosition(session.lines, Math.max(...ranges.map(({ newRange }) => newRange.to)))
  const lineDelta = session.lines.length - previousLines.length

  const markup = collectMarkup(session)
  const keys = markup.map((line) => lineKey(line, state.selection))

  const staleOldLines = new Set<number>()
  for (let index = firstChanged; index <= lastChangedOld; index += 1) staleOldLines.add(index)

  const added: Decoration[] = []
  session.lines.forEach((line, index) => {
    const isEdited = index >= firstChanged && index <= lastChangedNew
    const oldIndex = index < firstChanged ? index : index - lineDelta
    if (!isEdited && keys[index] === previous.keys[oldIndex]) return
    if (!isEdited) staleOldLines.add(oldIndex)
    added.push(...renderLine(line, markup[index], state.selection))
  })

  const removed = [...staleOldLines].flatMap((index) => decorationsOnLine(previous.decorations, previousLines[index]))
  return {
    session,
    markup,
    keys,
    decorations: previous.decorations.remove(removed).map(transaction.mapping, transaction.doc).add(state.doc, added),
    stale: false
  }
}

/** Renders Markdown as decorations over the untouched source text. */
function createLivePreviewPlugin() {
  let composing = false
  let pointerDown = false
  let settleTimer: number | undefined

  return new Plugin<LivePreviewState>({
    key: livePreviewKey,
    state: {
      init: (_config, state) => createPreviewState(state.doc, state.selection),
      apply: (transaction, previous, _oldState, state) => {
        // Redrawing around a live composition breaks the IME, so decorations only follow it.
        if (composing) {
          return transaction.docChanged
            ? { ...previous, decorations: previous.decorations.map(transaction.mapping, transaction.doc), stale: true }
            : previous
        }
        if (previous.stale) return createPreviewState(state.doc, state.selection, previous.session)
        if (transaction.docChanged) return updateDocument(previous, transaction, state)
        // Revealing under a pressed pointer shifts the text and misplaces a jittered click.
        if (pointerDown) return previous
        if (transaction.selectionSet || transaction.getMeta(livePreviewKey)) {
          return updateReveal(previous, state.doc, state.selection)
        }
        return previous
      }
    },
    props: {
      decorations: (state) => livePreviewKey.getState(state)?.decorations,
      handleDOMEvents: {
        mousedown: () => {
          pointerDown = true
          return false
        },
        compositionstart: () => {
          window.clearTimeout(settleTimer)
          composing = true
          return false
        },
        compositionend: (view) => {
          // Outlast ProseMirror's 20ms composition-end flush so the rebuild sees the committed text.
          settleTimer = window.setTimeout(() => {
            composing = false
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(livePreviewKey, true))
          }, COMPOSITION_END_SETTLE_MS)
          return false
        }
      }
    },
    view: (view) => {
      const releasePointer = () => {
        if (!pointerDown) return
        pointerDown = false
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(livePreviewKey, true))
      }
      window.addEventListener('mouseup', releasePointer)
      window.addEventListener('dragend', releasePointer)
      return {
        destroy: () => {
          window.clearTimeout(settleTimer)
          window.removeEventListener('mouseup', releasePointer)
          window.removeEventListener('dragend', releasePointer)
        }
      }
    }
  })
}

export const ComposerMarkdownLivePreview = Extension.create({
  name: 'composerMarkdownLivePreview',

  addProseMirrorPlugins() {
    return [createLivePreviewPlugin()]
  }
})
