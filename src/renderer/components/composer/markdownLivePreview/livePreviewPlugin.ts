import type { SyntaxNode } from '@lezer/common'
import { Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, type Selection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { createCodePairPlugin } from './codeBlockPairs'
import { createCodeHighlightPlugin } from './codeBlockPlugin'
import {
  createMarkdownSession,
  findSourceLineIndex,
  type MarkdownCodeBlock,
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
  code?: { block: MarkdownCodeBlock; line: SourceLine }
}

interface LivePreviewState {
  session: MarkdownSession
  markup: LineMarkup[]
  codeBlocks: MarkdownCodeBlock[]
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
  InlineCode: { mark: 'CodeMark', className: 'composer-md-inline-code' },
  Autolink: { mark: 'LinkMark', className: 'composer-md-link' }
}
const LITERAL_NODES = new Set(['Image', 'Table', 'HTMLBlock', 'HTMLTag', 'CodeBlock', 'LinkReference'])

const COMPOSITION_END_SETTLE_MS = 40

const SYNTAX_CLASS = 'composer-md-syntax'
const HIDDEN_SYNTAX_CLASS = `${SYNTAX_CLASS} composer-md-syntax-hidden`

function collectMarkup({ text, lines, tree }: MarkdownSession) {
  const markup = lines.map<LineMarkup>(() => ({ spans: [], markers: [], blockClasses: [] }))
  const codeBlocks: MarkdownCodeBlock[] = []
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
  const forEachTextSlice = (from: number, to: number, visit: (index: number, slice: Range) => void) => {
    forEachLineSlice(from, to, (index, slice) => {
      // Inline decorations affect the atom's own element, so skip token chips.
      const { textFrom } = lines[index]
      let start = slice.from
      for (let column = slice.from; column <= slice.to; column += 1) {
        if (column < slice.to && text[textFrom + column] !== TOKEN_PLACEHOLDER) continue
        if (column > start) visit(index, { from: start, to: column })
        start = column + 1
      }
    })
  }
  const addSpan = (from: number, to: number, className: string) => {
    forEachTextSlice(from, to, (index, slice) => markup[index].spans.push({ ...slice, className }))
  }
  const addMarker = (from: number, to: number, reveal: Range, options?: Pick<Marker, 'collapsesLine'>) => {
    const documentReveal = documentRange(reveal)
    forEachTextSlice(from, to, (index, slice) =>
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
    // Inline links have destination parentheses even when the URL is empty.
    if (marks.length !== 4) return
    addMarker(node.from, marks[0].to, node)
    addMarker(marks[1].from, node.to, node)
    addSpan(marks[0].to, marks[1].from, 'composer-md-link')
  }
  const addAtxHeading = (node: SyntaxNode, level: string) => {
    addSpan(node.from, node.to, `composer-md-heading composer-md-heading-${level}`)
    const [mark, closingMark] = node.getChildren('HeaderMark')
    if (!mark) return
    const end = mark.to + (/^[ \t]*/.exec(text.slice(mark.to, node.to))?.[0].length ?? 0)
    addMarker(mark.from, end, node)
    if (closingMark) addMarker(closingMark.from, node.to, node)
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

  const addCodeBlock = (node: SyntaxNode) => {
    const first = findSourceLineIndex(lines, node.from)
    const last = findSourceLineIndex(lines, node.to)
    const close = node.getChildren('CodeMark').length > 1 ? lines[last] : undefined
    const info = node.getChild('CodeInfo')
    const codeLines = lines.slice(first + 1, close ? last : last + 1)
    const block: MarkdownCodeBlock = {
      language: info ? text.slice(info.from, info.to).split(/\s+/)[0] : '',
      code: codeLines.map((line) => text.slice(line.textFrom, line.textTo)).join('\n'),
      reveal: documentRange(node),
      open: lines[first],
      codeLines,
      close,
      nested: node.parent?.name !== 'Document'
    }
    codeBlocks.push(block)
    for (let index = first; index <= last; index += 1) markup[index].code = { block, line: lines[index] }
  }

  tree.iterate({
    enter: (ref) => {
      const { name } = ref
      if (LITERAL_NODES.has(name)) return false
      if (name === 'FencedCode') {
        addCodeBlock(ref.node)
        return false
      }

      const delimited = DELIMITED_NODES[name]
      if (delimited) addDelimited(ref.node, delimited.mark, delimited.className)
      else if (name === 'Link') addLink(ref.node)
      else if (name === 'URL' && ref.node.parent?.name !== 'Link' && ref.node.parent?.name !== 'Autolink')
        addSpan(ref.from, ref.to, 'composer-md-link')
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

  return { markup, codeBlocks }
}

const isTouching = (selection: Selection, range: Range) => selection.from <= range.to && selection.to >= range.from
const isRevealed = (marker: Marker, selection: Selection) => isTouching(selection, marker.reveal)

/** Fences stay hidden unless the selection is in the block or the block has nothing else to show. */
function codeLineAttrs({ block, line }: NonNullable<LineMarkup['code']>, selection: Selection) {
  const showFences = isTouching(selection, block.reveal) || block.codeLines.length === 0
  if (!showFences && (line === block.open || line === block.close)) return { class: 'composer-md-line-hidden' }

  const first = showFences ? block.open : block.codeLines[0]
  const last = showFences ? (block.close ?? block.codeLines.at(-1) ?? block.open) : block.codeLines.at(-1)
  const classes = ['composer-md-cb-line']
  if (line === first) classes.push('composer-md-cb-first')
  if (line === last) classes.push('composer-md-cb-last')
  return { class: classes.join(' '), ...(line === first && block.language && { 'data-language': block.language }) }
}

function lineKey({ spans, markers, blockClasses, code }: LineMarkup, selection: Selection) {
  if (spans.length === 0 && markers.length === 0 && blockClasses.length === 0 && !code) return ''
  const spanKey = spans.map((span) => `${span.from}-${span.to}:${span.className}`).join()
  const markerKey = markers.map((marker) => `${marker.from}-${marker.to}:${+isRevealed(marker, selection)}`).join()
  const codeKey = code ? JSON.stringify(codeLineAttrs(code, selection)) : ''
  return `${spanKey}|${markerKey}|${blockClasses.join()}|${codeKey}`
}

function renderLine(line: SourceLine, markup: LineMarkup, selection: Selection): Decoration[] {
  const base = line.blockPosition + 1
  const inline = (range: Range, className: string) =>
    Decoration.inline(base + range.from, base + range.to, { class: className })
  const codeAttrs = markup.code && codeLineAttrs(markup.code, selection)
  const isCollapsed = markup.markers.some((marker) => marker.collapsesLine && !isRevealed(marker, selection))
  const blockClasses = [
    ...markup.blockClasses,
    ...(isCollapsed ? ['composer-md-line-hidden'] : []),
    ...(codeAttrs ? [codeAttrs.class] : [])
  ]

  return [
    ...markup.spans.map((span) => inline(span, span.className)),
    ...markup.markers.map((marker) =>
      inline(marker, isRevealed(marker, selection) ? SYNTAX_CLASS : HIDDEN_SYNTAX_CLASS)
    ),
    ...(blockClasses.length > 0
      ? [
          Decoration.node(line.blockPosition, line.blockPosition + line.blockSize, {
            ...codeAttrs,
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
  const { markup, codeBlocks } = collectMarkup(session)
  return {
    session,
    markup,
    codeBlocks,
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
    if (line.markers.length === 0 && !line.code) return
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

  const { markup, codeBlocks } = collectMarkup(session)
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
    codeBlocks,
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
        }
      }
    },
    view: (view) => {
      const startComposition = (event: CompositionEvent) => {
        if (event.target !== view.dom) return
        window.clearTimeout(settleTimer)
        composing = true
      }
      const endComposition = (event: CompositionEvent) => {
        if (event.target !== view.dom) return
        // Outlast ProseMirror's 20ms flush so the rebuild sees the committed text.
        settleTimer = window.setTimeout(() => {
          composing = false
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(livePreviewKey, true))
        }, COMPOSITION_END_SETTLE_MS)
      }
      const releasePointer = () => {
        if (!pointerDown) return
        pointerDown = false
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(livePreviewKey, true))
      }
      // The Composer can consume compositionend before ProseMirror calls plugin handlers.
      view.dom.addEventListener('compositionstart', startComposition, true)
      view.dom.addEventListener('compositionend', endComposition, true)
      window.addEventListener('mouseup', releasePointer)
      window.addEventListener('dragend', releasePointer)
      return {
        destroy: () => {
          window.clearTimeout(settleTimer)
          view.dom.removeEventListener('compositionstart', startComposition, true)
          view.dom.removeEventListener('compositionend', endComposition, true)
          window.removeEventListener('mouseup', releasePointer)
          window.removeEventListener('dragend', releasePointer)
        }
      }
    }
  })
}

/** Composition defers the parse, so a stale state answers from the current document instead. */
export function getMarkdownCodeBlocks(state: EditorState): MarkdownCodeBlock[] {
  const preview = livePreviewKey.getState(state)
  if (!preview) return []
  return preview.stale ? collectMarkup(createMarkdownSession(state.doc)).codeBlocks : preview.codeBlocks
}

export function findMarkdownCodeLine(state: EditorState, position: number) {
  for (const block of getMarkdownCodeBlocks(state)) {
    for (const line of [block.open, ...block.codeLines, ...(block.close ? [block.close] : [])]) {
      if (position > line.blockPosition && position < line.blockPosition + line.blockSize) return { block, line }
    }
  }
  return null
}

export const isMarkdownFencedCodePosition = (state: EditorState, position: number) =>
  findMarkdownCodeLine(state, position) !== null

export const ComposerMarkdownLivePreview = Extension.create({
  name: 'composerMarkdownLivePreview',

  addProseMirrorPlugins() {
    return [
      createLivePreviewPlugin(),
      createCodeHighlightPlugin(getMarkdownCodeBlocks),
      createCodePairPlugin(findMarkdownCodeLine)
    ]
  }
})
