/**
 * PROTOTYPE - throwaway spike, do not merge.
 *
 * Question: can a plain-text Tiptap document render Markdown through decorations alone, with
 * acceptable caret movement, IME composition and a real highlighted code block region?
 * Text is never rewritten; the only structural change is one paragraph per source line.
 */
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey, type Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { codeHighlightService } from '@renderer/services/CodeHighlightService'

import { serializeComposerDocument } from './composerDraft'

type Range = { from: number; to: number }
type StyleSpan = Range & { className: string }
type SyntaxMarker = Range & { reveal: Range }
type SourceLine = { textFrom: number; textTo: number; blockPosition: number; blockSize: number }
type LineClass = { line: SourceLine; className: string }
type CodeBlockRegion = {
  language: string
  code: string
  reveal: Range
  open?: SourceLine
  close?: SourceLine
  codeLines: SourceLine[]
}
type Analysis = {
  styles: StyleSpan[]
  markers: SyntaxMarker[]
  lineClasses: LineClass[]
  codeBlocks: CodeBlockRegion[]
  parseMs: number
}
type PreviewState = { analysis: Analysis; decorations: DecorationSet }
type MdNode = {
  type: string
  depth?: number
  lang?: string | null
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: MdNode[]
}

const OBJECT_REPLACEMENT = '￼'
const STYLE_ELEMENT_ID = 'composer-markdown-prototype-style'
const COMPOSITION_END_SETTLE_MS = 50
const CODE_INDENT = '  '
const previewKey = new PluginKey<PreviewState>('composerMarkdownPreviewPrototype')

// display:none makes Chromium canonicalize the caret past the hidden run, so moving left jumps over
// closing markers. Zero-size text stays rendered and keeps every position addressable.
const PROTOTYPE_CSS = `
.composer-md-syntax { color: var(--muted-foreground); }
.composer-md-syntax-hidden { font-size: 0 !important; }
.composer-md-strong { font-weight: 600; }
.composer-md-emphasis { font-style: italic; }
.composer-md-delete { text-decoration: line-through; }
.composer-md-inline-code { font-family: var(--code-font-family, ui-monospace, monospace); background: var(--muted); border-radius: 3px; padding: 0 3px; }
.composer-md-link { color: var(--primary); text-decoration: underline; }
.composer-md-heading { font-weight: 600; }
.composer-md-heading-1 { font-size: 1.5em; }
.composer-md-heading-2 { font-size: 1.3em; }
.composer-md-heading-3 { font-size: 1.15em; }
.composer-md-quote { color: var(--muted-foreground); }
.composer-md-list-marker { color: var(--muted-foreground); }
.composer-md-thematic-break { color: var(--muted-foreground); }
.composer-tiptap.tiptap p.composer-md-quote-line { border-left: 2px solid var(--border); padding-left: 10px; }
.composer-tiptap.tiptap p.composer-md-list-line { padding-left: 1.4em; text-indent: -1.4em; }
.composer-tiptap.tiptap p.composer-md-line-hidden { height: 0; overflow: hidden; line-height: 0 !important; }
.composer-tiptap.tiptap p.composer-md-cb-line { position: relative; padding: 0 12px; font-family: var(--code-font-family, ui-monospace, monospace); font-size: 0.93em; line-height: 1.55 !important; color: var(--code-foreground, var(--foreground)); background: var(--background-subtle); border-left: 0.5px solid var(--border); border-right: 0.5px solid var(--border); }
.composer-tiptap.tiptap p.composer-md-cb-first { padding-top: 8px; margin-top: 4px !important; border-top: 0.5px solid var(--border); border-top-left-radius: 8px; border-top-right-radius: 8px; }
.composer-tiptap.tiptap p.composer-md-cb-last { padding-bottom: 8px; margin-bottom: 4px !important; border-bottom: 0.5px solid var(--border); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }
.composer-tiptap.tiptap p.composer-md-cb-first[data-language]::after { content: attr(data-language); position: absolute; top: 6px; right: 10px; font-size: 11px; color: var(--muted-foreground); pointer-events: none; user-select: none; }
`

const markdownParser = unified().use(remarkParse).use(remarkGfm)

function getTextblockSource(block: ProseMirrorNode) {
  let source = ''
  block.forEach((child) => {
    if (child.isText) source += child.text ?? ''
    else source += child.type.name === 'hardBreak' ? '\n' : OBJECT_REPLACEMENT
  })
  return source
}

function getDocumentSource(doc: ProseMirrorNode) {
  const lines: SourceLine[] = []
  let text = ''
  doc.forEach((block, blockPosition) => {
    if (lines.length > 0) text += '\n'
    const textFrom = text.length
    text += getTextblockSource(block)
    lines.push({ textFrom, textTo: text.length, blockPosition, blockSize: block.nodeSize })
  })
  return { text, lines }
}

function findLineIndex(lines: SourceLine[], offset: number) {
  let low = 0
  let high = lines.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (lines[middle].textFrom <= offset) low = middle
    else high = middle - 1
  }
  return low
}

function forEachLine(text: string, from: number, to: number, visit: (line: Range) => void) {
  let start = from
  while (start <= to) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 || newline > to ? to : newline
    visit({ from: start, to: end })
    if (newline < 0 || newline >= to) break
    start = newline + 1
  }
}

function analyzeDocument(doc: ProseMirrorNode): Analysis {
  const startedAt = performance.now()
  const analysis: Analysis = { styles: [], markers: [], lineClasses: [], codeBlocks: [], parseMs: 0 }
  const { text, lines } = getDocumentSource(doc)
  const finish = () => {
    analysis.parseMs = Math.round((performance.now() - startedAt) * 10) / 10
    return analysis
  }
  if (!text.trim()) return finish()

  const toPosition = (offset: number) => {
    const line = lines[findLineIndex(lines, offset)]
    return line.blockPosition + 1 + (offset - line.textFrom)
  }
  const toRange = (range: Range) => ({ from: toPosition(range.from), to: toPosition(range.to) })
  const addStyle = (from: number, to: number, className: string) => {
    if (to > from) analysis.styles.push({ from: toPosition(from), to: toPosition(to), className })
  }
  const addMarker = (from: number, to: number, reveal: Range) => {
    if (to > from) analysis.markers.push({ from: toPosition(from), to: toPosition(to), reveal: toRange(reveal) })
  }
  const addLineClass = (offset: number, className: string) => {
    analysis.lineClasses.push({ line: lines[findLineIndex(lines, offset)], className })
  }
  const addDelimited = (from: number, to: number, width: number, className: string) => {
    const reveal = { from, to }
    addMarker(from, from + width, reveal)
    addMarker(to - width, to, reveal)
    addStyle(from + width, to - width, className)
  }

  const visit = (node: MdNode) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return

    switch (node.type) {
      case 'strong':
        addDelimited(start, end, 2, 'composer-md-strong')
        break
      case 'emphasis':
        addDelimited(start, end, 1, 'composer-md-emphasis')
        break
      case 'delete':
        addDelimited(start, end, text.startsWith('~~', start) ? 2 : 1, 'composer-md-delete')
        break
      case 'inlineCode':
        addDelimited(start, end, /^`+/.exec(text.slice(start, end))?.[0].length ?? 1, 'composer-md-inline-code')
        break
      case 'link': {
        const labelEnd = node.children?.at(-1)?.position?.end.offset
        if (text[start] === '[' && labelEnd !== undefined) {
          const reveal = { from: start, to: end }
          addMarker(start, start + 1, reveal)
          addMarker(labelEnd, end, reveal)
          addStyle(start + 1, labelEnd, 'composer-md-link')
        }
        break
      }
      case 'heading': {
        addStyle(start, end, `composer-md-heading composer-md-heading-${node.depth}`)
        const marker = /^#{1,6}[ \t]*/.exec(text.slice(start, end))
        if (marker) addMarker(start, start + marker[0].length, { from: start, to: end })
        break
      }
      case 'blockquote':
        forEachLine(text, start, end, (line) => {
          addStyle(line.from, line.to, 'composer-md-quote')
          addLineClass(line.from, 'composer-md-quote-line')
          const marker = /^[ \t]*>[ \t]?/.exec(text.slice(line.from, line.to))
          if (marker) addMarker(line.from, line.from + marker[0].length, line)
        })
        break
      case 'listItem':
        addStyle(start, node.children?.[0]?.position?.start.offset ?? end, 'composer-md-list-marker')
        addLineClass(start, 'composer-md-list-line')
        break
      case 'code': {
        const fenced = /^(`{3,}|~{3,})/.test(text.slice(start, end))
        const blockLines = lines.slice(findLineIndex(lines, start), findLineIndex(lines, end) + 1)
        const last = blockLines[blockLines.length - 1]
        const closed =
          fenced && blockLines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(text.slice(last.textFrom, last.textTo))
        const codeLines = blockLines.slice(fenced ? 1 : 0, closed ? -1 : undefined)
        const open = fenced ? blockLines[0] : undefined
        const close = closed ? last : undefined
        const reveal = { from: start, to: end }
        if (open) addMarker(open.textFrom, open.textTo, reveal)
        if (close) addMarker(close.textFrom, close.textTo, reveal)
        analysis.codeBlocks.push({
          language: node.lang ?? '',
          code: codeLines.map((line) => text.slice(line.textFrom, line.textTo)).join('\n'),
          reveal: toRange(reveal),
          open,
          close,
          codeLines
        })
        break
      }
      case 'thematicBreak':
        addStyle(start, end, 'composer-md-thematic-break')
        break
    }

    node.children?.forEach(visit)
  }

  visit(markdownParser.parse(text))
  return finish()
}

const isTouching = (selection: Selection, range: Range) => selection.from <= range.to && selection.to >= range.from
const lineDecoration = (line: SourceLine, attrs: Record<string, string>) =>
  Decoration.node(line.blockPosition, line.blockPosition + line.blockSize, attrs)

function buildCodeBlockDecorations(block: CodeBlockRegion, selection: Selection) {
  const fences = [block.open, block.close].filter((line): line is SourceLine => !!line)
  const revealed = isTouching(selection, block.reveal)
  const expanded = [
    ...(revealed && block.open ? [block.open] : []),
    ...block.codeLines,
    ...(revealed && block.close ? [block.close] : [])
  ]
  const region = expanded.length > 0 ? expanded : fences

  return [
    ...region.map((line, index) => {
      const classes = ['composer-md-cb-line']
      if (index === 0) classes.push('composer-md-cb-first')
      if (index === region.length - 1) classes.push('composer-md-cb-last')
      return lineDecoration(line, {
        class: classes.join(' '),
        ...(index === 0 && block.language && { 'data-language': block.language })
      })
    }),
    ...fences
      .filter((line) => !region.includes(line))
      .map((line) => lineDecoration(line, { class: 'composer-md-line-hidden' }))
  ]
}

function buildDecorations(analysis: Analysis, selection: Selection, doc: ProseMirrorNode) {
  return DecorationSet.create(doc, [
    ...analysis.styles.map((span) => Decoration.inline(span.from, span.to, { class: span.className })),
    ...analysis.markers.map((marker) =>
      Decoration.inline(marker.from, marker.to, {
        class: isTouching(selection, marker.reveal)
          ? 'composer-md-syntax'
          : 'composer-md-syntax composer-md-syntax-hidden'
      })
    ),
    ...analysis.lineClasses.map(({ line, className }) => lineDecoration(line, { class: className })),
    ...analysis.codeBlocks.flatMap((block) => buildCodeBlockDecorations(block, selection))
  ])
}

function createPreviewState(doc: ProseMirrorNode, selection: Selection): PreviewState {
  const analysis = analyzeDocument(doc)
  return { analysis, decorations: buildDecorations(analysis, selection, doc) }
}

/** Every input path still produces hard breaks; folding them here gives one paragraph per source line. */
function createLineNormalization(state: EditorState) {
  const breaks: number[] = []
  state.doc.descendants((node, position) => {
    if (node.type.name === 'hardBreak') breaks.push(position)
  })
  if (breaks.length === 0) return null
  const transaction = state.tr
  breaks.reverse().forEach((position) => transaction.delete(position, position + 1).split(position))
  return transaction
}

function installPrototypeStyles() {
  const style =
    document.getElementById(STYLE_ELEMENT_ID) ??
    document.head.appendChild(Object.assign(document.createElement('style'), { id: STYLE_ELEMENT_ID }))
  style.textContent = PROTOTYPE_CSS
}

function createDebugPanel(getSnapshot: () => Record<string, unknown>, view: EditorView) {
  const panel = document.createElement('pre')
  Object.assign(panel.style, {
    position: 'fixed',
    top: '48px',
    right: '8px',
    zIndex: '99999',
    maxWidth: '380px',
    maxHeight: '40vh',
    overflow: 'auto',
    padding: '8px',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    pointerEvents: 'none',
    background: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px'
  })
  panel.hidden = true
  document.body.appendChild(panel)

  return {
    update: () => {
      panel.hidden = !view.hasFocus()
      if (panel.hidden) return
      const snapshot = getSnapshot()
      panel.textContent = `PROTOTYPE\n${JSON.stringify(snapshot, null, 2)}`
      ;(window as unknown as Record<string, unknown>).__composerMarkdownPrototype = getSnapshot
    },
    destroy: () => panel.remove()
  }
}

const blockKey = (block: CodeBlockRegion) => `${block.language}\0${block.code}`

function createCodeHighlightPlugin(previewKey: PluginKey<PreviewState>) {
  const highlightKey = new PluginKey<DecorationSet>('composerMarkdownPreviewPrototypeHighlight')

  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, decorations) =>
        (transaction.getMeta(highlightKey) as DecorationSet | undefined) ??
        decorations.map(transaction.mapping, transaction.doc)
    },
    props: { decorations: (state) => highlightKey.getState(state) },
    view: (view) => {
      const owner = `composer-md:${Math.random().toString(36).slice(2)}`
      const requested = new Map<number, string>()
      const results = new Map<
        number,
        { key: string; lines: Awaited<ReturnType<typeof codeHighlightService.highlightRange>>['lines'] }
      >()
      const getBlocks = () => previewKey.getState(view.state)?.analysis.codeBlocks ?? []
      let destroyed = false

      const applyResults = () => {
        if (destroyed || view.composing) return
        const decorations = getBlocks().flatMap((block, index) => {
          const result = results.get(index)
          if (result?.key !== blockKey(block)) return []
          return result.lines.flatMap((tokens, lineIndex) => {
            const line = block.codeLines[lineIndex]
            if (!line) return []
            const start = line.blockPosition + 1
            return tokens.flatMap((token) =>
              token.className && token.content
                ? [
                    Decoration.inline(start + token.offset, start + token.offset + token.content.length, {
                      class: token.className
                    })
                  ]
                : []
            )
          })
        })
        if (decorations.length === 0 && highlightKey.getState(view.state)?.find().length === 0) return
        view.dispatch(
          view.state.tr
            .setMeta(highlightKey, DecorationSet.create(view.state.doc, decorations))
            .setMeta('addToHistory', false)
        )
      }

      const sync = () => {
        if (destroyed || view.composing) return
        getBlocks().forEach((block, index) => {
          const key = blockKey(block)
          if (requested.get(index) === key) return
          requested.set(index, key)
          void codeHighlightService
            .highlightRange(block.code, block.language || 'text', '', `${owner}:${index}`, {
              start: 0,
              end: block.codeLines.length
            })
            .then((result) => {
              if (destroyed) return
              results.set(index, { key, lines: result.lines })
              const current = getBlocks()[index]
              if (current && blockKey(current) === key) applyResults()
            })
        })
        // A whole-document replace deletes the mapped colors while the code, and so the cache key, stays equal.
        if (highlightKey.getState(view.state)?.find().length === 0) queueMicrotask(applyResults)
      }

      sync()
      return {
        update: sync,
        destroy: () => {
          destroyed = true
          requested.forEach((_key, index) => codeHighlightService.cleanupTokenizers(`${owner}:${index}`))
        }
      }
    }
  })
}

type CodeLineMatch = { block: CodeBlockRegion; line: SourceLine }

function findCodeLine(state: EditorState, position: number): CodeLineMatch | null {
  for (const block of previewKey.getState(state)?.analysis.codeBlocks ?? []) {
    for (const line of [block.open, ...block.codeLines, block.close]) {
      if (line && position > line.blockPosition && position < line.blockPosition + line.blockSize)
        return { block, line }
    }
  }
  return null
}

export const isComposerMarkdownCodePosition = (state: EditorState, position: number) =>
  findCodeLine(state, position) !== null

function insertCodeNewline(view: EditorView, { block, line }: CodeLineMatch) {
  const { state } = view
  const { $from, from, to, empty } = state.selection
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, OBJECT_REPLACEMENT)
  const transaction = state.tr
  if (!empty) transaction.delete(from, to)
  transaction.split(from)
  const nextLineStart = from + 2

  if (line === block.open) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(before)?.[1]
    const atLineEnd = $from.parentOffset === $from.parent.content.size
    if (fence && atLineEnd && !block.close && block.codeLines.length === 0) {
      transaction.insert(nextLineStart + 1, state.schema.nodes.paragraph.create(null, state.schema.text(fence)))
      transaction.setSelection(TextSelection.create(transaction.doc, nextLineStart))
    }
  } else if (line !== block.close) {
    const indent = (/^[ \t]*/.exec(before)?.[0] ?? '') + (/[{[(]\s*$/.test(before) ? CODE_INDENT : '')
    if (indent) transaction.insertText(indent, nextLineStart)
  }
  view.dispatch(transaction.scrollIntoView())
}

function indentCodeSelection(view: EditorView, outdent: boolean) {
  const { state } = view
  const { from, to, empty } = state.selection
  if (empty && !outdent) {
    view.dispatch(state.tr.insertText(CODE_INDENT, from).scrollIntoView())
    return
  }

  const lineStarts: number[] = []
  state.doc.nodesBetween(from, to, (node, position) => {
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
    const width = Math.min(CODE_INDENT.length, /^ */.exec(state.doc.resolve(start).parent.textContent)?.[0].length ?? 0)
    if (width > 0) transaction.delete(start, start + width)
  })
  if (transaction.docChanged) view.dispatch(transaction.scrollIntoView())
}

/** Inside a code block every Enter combination is a newline and Tab indents; sending only happens outside it. */
export function handleComposerMarkdownCodeKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.isComposing) return false
  const isEnter = event.key === 'Enter' || event.key === 'NumpadEnter'
  if (!isEnter && event.key !== 'Tab') return false

  const match = findCodeLine(view.state, view.state.selection.from)
  if (!match) return false

  if (isEnter) insertCodeNewline(view, match)
  else indentCodeSelection(view, event.shiftKey)
  return true
}

export const ComposerMarkdownPreviewPrototype = Extension.create({
  name: 'composerMarkdownPreviewPrototype',

  addProseMirrorPlugins() {
    const editor = this.editor
    const key = previewKey
    let composing = false
    let pointerDown = false

    return [
      new Plugin<PreviewState>({
        key,
        appendTransaction: (transactions, _oldState, state) =>
          !composing && transactions.some((transaction) => transaction.docChanged)
            ? createLineNormalization(state)
            : null,
        state: {
          init: (_config, state) => createPreviewState(state.doc, state.selection),
          apply: (transaction, previous, _oldState, nextState) => {
            // Redrawing around a live composition is what would break the IME, so only map until it ends.
            // Revealing under a pressed pointer shifts the text, so a small hand jitter misplaces the caret.
            if (composing || (pointerDown && !transaction.docChanged)) {
              return { ...previous, decorations: previous.decorations.map(transaction.mapping, transaction.doc) }
            }
            if (transaction.docChanged || transaction.getMeta(key)) {
              return createPreviewState(nextState.doc, nextState.selection)
            }
            if (transaction.selectionSet) {
              return {
                ...previous,
                decorations: buildDecorations(previous.analysis, nextState.selection, nextState.doc)
              }
            }
            return previous
          }
        },
        props: {
          decorations: (state) => key.getState(state)?.decorations,
          handleDOMEvents: {
            mousedown: () => {
              pointerDown = true
              return false
            },
            compositionstart: () => {
              composing = true
              return false
            },
            compositionend: (view) => {
              composing = false
              window.setTimeout(() => {
                if (view.isDestroyed || view.composing) return
                view.dispatch(view.state.tr.setMeta(key, 'refresh'))
              }, COMPOSITION_END_SETTLE_MS)
              return false
            }
          }
        },
        view: (view) => {
          installPrototypeStyles()
          // Restored drafts arrive through the initial doc, which appendTransaction never sees.
          window.setTimeout(() => {
            if (view.isDestroyed) return
            const normalization = createLineNormalization(view.state)
            if (normalization) view.dispatch(normalization.setMeta('addToHistory', false))
          })
          const releasePointer = () => {
            if (!pointerDown) return
            pointerDown = false
            view.dispatch(view.state.tr.setMeta(key, 'refresh'))
          }
          window.addEventListener('mouseup', releasePointer)
          const panel = createDebugPanel(() => {
            const state = key.getState(view.state)
            const { selection } = view.state
            return {
              serialized: serializeComposerDocument(editor.getJSON()).text,
              selection: { from: selection.from, to: selection.to },
              docSize: view.state.doc.content.size,
              lines: view.state.doc.childCount,
              composing: view.composing,
              parseMs: state?.analysis.parseMs,
              markers: state?.analysis.markers.length,
              codeBlocks: state?.analysis.codeBlocks.map((block) => block.language || '(none)')
            }
          }, view)
          return {
            update: panel.update,
            destroy: () => {
              window.removeEventListener('mouseup', releasePointer)
              panel.destroy()
            }
          }
        }
      }),
      createCodeHighlightPlugin(key)
    ]
  }
})
