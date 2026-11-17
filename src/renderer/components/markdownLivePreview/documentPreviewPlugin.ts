import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { documentBlocks, documentSource } from './documentSource'
import { createMarkdownSession, findSourceLineIndex, type MarkdownSession, toDocumentPosition } from './markdownSession'

export interface PreviewTarget {
  from: number
  to: number
  dom: HTMLElement
}

interface PreviewState {
  source: string
  targets: PreviewTarget[]
  decorations: DecorationSet
  focused: boolean
}

export const documentPreviewKey = new PluginKey<PreviewState>('markdownDocumentPreview')

export function createDocumentPreviewPlugin(onChange: (state: PreviewState) => void) {
  let composing = false
  let settleTimer: number | undefined
  let pointerDown = false
  let cachedSession: MarkdownSession | undefined
  let cachedBlocks: ReturnType<typeof documentBlocks> = []

  function build(state: EditorState, focused: boolean, previous?: PreviewState): PreviewState {
    const source = documentSource(state.doc)
    if (cachedSession?.text !== source) cachedBlocks = documentBlocks(source)
    const session = createMarkdownSession(state.doc, cachedSession)
    cachedSession = session
    const blocks = cachedBlocks
    const renderedBlocks = blocks.filter((block) => block.rendered)
    const change = session.change
    const renderedIndexes = new Map(renderedBlocks.map((block, index) => [block, index]))
    const previousTargets = new Map(
      previous?.targets.map((target) => {
        const offset = change && target.from >= change.toOld ? target.from + change.toNew - change.toOld : target.from
        return [offset, target]
      })
    )
    const decorations: Decoration[] = []
    const targets: PreviewTarget[] = []
    const visibleLines = new Set<number>()
    for (const block of blocks) {
      const from = toDocumentPosition(session.lines, block.from)
      const to = toDocumentPosition(session.lines, block.to)
      const active = focused && state.selection.from <= to && state.selection.to >= from
      const lines = session.lines.slice(
        findSourceLineIndex(session.lines, block.from),
        findSourceLineIndex(session.lines, block.to) + 1
      )
      if (active) {
        lines.forEach((line) => visibleLines.add(line.blockPosition))
        continue
      }
      const dom = previousTargets.get(block.from)?.dom ?? document.createElement('div')
      dom.contentEditable = 'false'
      dom.className = 'markdown-live-block'
      dom.dataset.sourceFrom = String(block.from)
      dom.toggleAttribute('data-preview-first', block === renderedBlocks[0])
      dom.toggleAttribute('data-preview-last', block === renderedBlocks.at(-1))
      const index = renderedIndexes.get(block)
      dom.dataset.previewNext = index === undefined ? '' : (renderedBlocks[index + 1]?.type ?? '')
      dom.dataset.previewPrevious = index === undefined ? '' : (renderedBlocks[index - 1]?.type ?? '')
      const target = { ...block, dom }
      targets.push(target)
      decorations.push(Decoration.widget(lines[0].blockPosition, dom, { side: -1 }))
    }
    for (const line of session.lines) {
      const selected =
        focused &&
        state.selection.from <= line.blockPosition + line.blockSize - 1 &&
        state.selection.to >= line.blockPosition + 1
      if (visibleLines.has(line.blockPosition) || selected) continue
      decorations.push(
        Decoration.node(line.blockPosition, line.blockPosition + line.blockSize, {
          class: 'markdown-live-source-hidden'
        })
      )
    }
    const footer = previousTargets.get(-1)?.dom ?? document.createElement('div')
    footer.contentEditable = 'false'
    targets.push({ from: -1, to: -1, dom: footer })
    decorations.push(Decoration.widget(state.doc.content.size, footer, { side: 1, key: 'footer' }))
    return { source, targets, decorations: DecorationSet.create(state.doc, decorations), focused }
  }

  return new Plugin<PreviewState>({
    key: documentPreviewKey,
    state: {
      init: (_config, state) => build(state, false),
      apply: (transaction, previous, _old, state) => {
        if (composing) return { ...previous, decorations: previous.decorations.map(transaction.mapping, state.doc) }
        const focus = transaction.getMeta(documentPreviewKey) as boolean | undefined
        if (!transaction.docChanged && (pointerDown || (!transaction.selectionSet && focus === undefined)))
          return previous
        return build(state, focus ?? previous.focused, previous)
      }
    },
    props: {
      decorations: (state) => documentPreviewKey.getState(state)?.decorations,
      handleDOMEvents: {
        focus: (view) => {
          view.dispatch(view.state.tr.setMeta(documentPreviewKey, true))
          return false
        },
        blur: (view) => {
          view.dispatch(view.state.tr.setMeta(documentPreviewKey, false))
          return false
        },
        mousedown: (_view, event) => {
          pointerDown = true
          return event.target instanceof Element && !!event.target.closest('[data-source-from]')
        },
        click: (view, event) => {
          if (
            !view.editable ||
            !(event.target instanceof Element) ||
            event.target.closest('a,button,input,textarea,select,[role="button"],img.cursor-zoom-in')
          )
            return false
          const block = event.target.closest<HTMLElement>('[data-source-from]')
          if (!block) return false
          event.preventDefault()
          const session = createMarkdownSession(view.state.doc, cachedSession)
          const position = toDocumentPosition(session.lines, Number(block.dataset.sourceFrom))
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).setMeta(documentPreviewKey, true)
          )
          view.focus()
          return true
        }
      }
    },
    view: (view: EditorView) => {
      const publish = () => onChange(documentPreviewKey.getState(view.state)!)
      const start = () => {
        composing = true
        window.clearTimeout(settleTimer)
      }
      const end = () => {
        settleTimer = window.setTimeout(() => {
          composing = false
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(documentPreviewKey, view.hasFocus()))
        }, 40)
      }
      const release = () => {
        if (!pointerDown) return
        pointerDown = false
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(documentPreviewKey, view.hasFocus()))
      }
      view.dom.addEventListener('compositionstart', start, true)
      view.dom.addEventListener('compositionend', end, true)
      window.addEventListener('mouseup', release)
      window.addEventListener('dragend', release)
      publish()
      return {
        update: () => {
          if (!composing) publish()
        },
        destroy: () => {
          window.clearTimeout(settleTimer)
          view.dom.removeEventListener('compositionstart', start, true)
          view.dom.removeEventListener('compositionend', end, true)
          window.removeEventListener('mouseup', release)
          window.removeEventListener('dragend', release)
        }
      }
    }
  })
}
