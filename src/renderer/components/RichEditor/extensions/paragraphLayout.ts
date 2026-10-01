import '@cherrystudio/ui/components/composites/paragraph-layout.css'
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { composeParagraph, createParagraphMeasure, type ParagraphRun } from '@cherrystudio/ui/lib/paragraph-layout'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ParagraphLayout')
const key = new PluginKey<DecorationSet>('paragraphLayout')

function layoutParagraph(
  view: EditorView,
  node: ProseMirrorNode,
  position: number,
  measurer: ReturnType<typeof createParagraphMeasure>
) {
  const decorations: Decoration[] = []
  const element = view.nodeDOM(position)
  if (!(element instanceof HTMLElement)) return []
  const style = getComputedStyle(element)
  if (!['left', 'start', 'justify'].includes(style.textAlign)) return []
  const runs: ParagraphRun[] = []
  const positions: number[] = []
  let supported = true
  node.forEach((child, offset) => {
    const from = position + 1 + offset
    const dom = view.domAtPos(from, 1)
    let target = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
    if (target?.hasAttribute('data-paragraph-piece')) target = target.parentElement
    if (!target) {
      supported = false
      return
    }
    const metrics = measurer.metrics(target)
    if (!metrics) {
      supported = false
      return
    }
    const text = child.isText ? child.text! : '\ufffc'
    if (/\r|\n/.test(text) && style.whiteSpace !== 'normal' && style.whiteSpace !== 'nowrap') supported = false
    positions.push(from)
    if (child.isText) {
      if (child.marks.some((mark) => mark.type.name === 'code')) {
        const code = target.closest('code')
        if (!code || code.textContent !== text) {
          supported = false
          return
        }
        runs.push({ text, metrics, atomicWidth: code.getBoundingClientRect().width })
      } else runs.push({ text, metrics })
    } else if (child.type.name === 'inlineMath') {
      const atomic = view.nodeDOM(from)
      if (!(atomic instanceof HTMLElement)) {
        supported = false
        return
      }
      runs.push({ text, metrics, atomicWidth: atomic.getBoundingClientRect().width })
    } else supported = false
  })
  if (!supported) return []
  const layout = composeParagraph(
    runs,
    element.getBoundingClientRect().width,
    measurer.measure,
    element.closest('[lang]')?.getAttribute('lang') ?? ''
  )
  if (!layout) return []
  decorations.push(Decoration.node(position, position + node.nodeSize, { 'data-paragraph-layout': 'composed' }))
  layout.runs.forEach((pieces, run) => {
    for (const piece of pieces) {
      const from = positions[run] + piece.from
      const to = positions[run] + piece.to
      if (piece.kind === 'atomic') continue
      if (from !== to) {
        decorations.push(
          Decoration.inline(from, to, {
            nodeName: 'span',
            'data-paragraph-piece': piece.kind,
            style: `width:${Math.max(0, piece.width)}px;margin-inline-end:${Math.min(0, piece.width)}px`
          })
        )
      } else if (piece.kind === 'break' || piece.kind === 'hyphen' || piece.width !== 0) {
        decorations.push(
          Decoration.widget(
            from,
            () => {
              const span = document.createElement('span')
              span.dataset.paragraphPiece = piece.kind
              span.setAttribute('aria-hidden', 'true')
              if (piece.kind === 'space') {
                span.style.width = `${Math.max(0, piece.width)}px`
                span.style.marginInlineEnd = `${Math.min(0, piece.width)}px`
              }
              return span
            },
            { side: -1, key: `${from}:${piece.kind}:${piece.width}` }
          )
        )
      }
    }
  })
  return decorations
}

export const ParagraphLayout = Extension.create<{ enabled: boolean }>({
  name: 'paragraphLayout',
  addOptions: () => ({ enabled: false }),
  addProseMirrorPlugins() {
    if (!this.options.enabled) return []
    const editor = this.editor
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, decorations) => tr.getMeta(key) ?? (tr.docChanged ? DecorationSet.empty : decorations)
        },
        props: {
          decorations: (state) => (editor.isEditable ? DecorationSet.empty : key.getState(state)),
          handleDOMEvents: {
            copy(view, event) {
              // Keep ProseMirror's document serializer authoritative over the global DOM-based copy-tex handler.
              if (!editor.isEditable && key.getState(view.state)?.find().length) event.stopPropagation()
              return false
            }
          }
        },
        view(view) {
          const measurer = createParagraphMeasure()
          let frame = 0
          let dirty = true
          let width = -1
          let font = ''
          let editable = editor.isEditable
          let queue: { node: ProseMirrorNode; position: number; distance: number }[] = []
          let decorations = DecorationSet.empty
          const schedule = () => {
            dirty = true
            if (!frame) frame = requestAnimationFrame(update)
          }
          const update = () => {
            frame = 0
            if (editor.isDestroyed || editor.isEditable) return
            const selection = window.getSelection()
            if (selection && !selection.isCollapsed && view.dom.contains(selection.anchorNode)) return
            try {
              if (dirty) {
                dirty = false
                queue = []
                decorations = DecorationSet.empty
                view.dispatch(view.state.tr.setMeta(key, decorations).setMeta('addToHistory', false))
                const viewport =
                  view.dom.closest('.rich-editor-content')?.getBoundingClientRect() ?? view.dom.getBoundingClientRect()
                view.state.doc.descendants((node, position) => {
                  if (node.type.name === 'table' || node.type.name.endsWith('List')) return false
                  if (node.type.name !== 'paragraph') return
                  const element = view.nodeDOM(position)
                  if (element instanceof HTMLElement) {
                    const rect = element.getBoundingClientRect()
                    queue.push({
                      node,
                      position,
                      distance: Math.max(viewport.top - rect.bottom, rect.top - viewport.bottom, 0)
                    })
                  }
                  return false
                })
                queue.sort((a, b) => a.distance - b.distance)
              }
              const started = performance.now()
              const batch: { from: number; to: number }[] = []
              while (queue.length && performance.now() - started < 4) {
                const { node, position } = queue.shift()!
                decorations = decorations.add(view.state.doc, layoutParagraph(view, node, position, measurer))
                batch.push({ from: position, to: position + node.nodeSize })
              }
              view.dispatch(view.state.tr.setMeta(key, decorations).setMeta('addToHistory', false))
              const overflow = batch.flatMap(({ from, to }) => {
                const element = view.nodeDOM(from)
                return element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1
                  ? decorations.find(from, to)
                  : []
              })
              if (overflow.length) {
                decorations = decorations.remove(overflow)
                view.dispatch(view.state.tr.setMeta(key, decorations).setMeta('addToHistory', false))
              }
              view.dom.dispatchEvent(new Event('paragraph-layout', { bubbles: true }))
              if (queue.length) frame = requestAnimationFrame(update)
            } catch (error) {
              logger.error('Readonly paragraph layout failed', { error })
            }
          }

          const resize = new ResizeObserver(() => {
            const style = getComputedStyle(view.dom)
            const next = `${style.fontFamily}:${style.fontSize}:${style.fontWeight}:${style.fontStyle}:${style.letterSpacing}:${style.wordSpacing}`
            const nextWidth = view.dom.getBoundingClientRect().width
            if (nextWidth !== width || next !== font) {
              width = nextWidth
              font = next
              schedule()
            }
          })
          const fonts = () => {
            measurer.clear()
            schedule()
          }
          const selection = () => {
            if ((dirty || queue.length) && !frame) frame = requestAnimationFrame(update)
          }
          resize.observe(view.dom)
          document.fonts.addEventListener('loadingdone', fonts)
          document.addEventListener('selectionchange', selection)
          schedule()
          return {
            update(current, previous) {
              if (previous.doc !== current.state.doc || editable !== editor.isEditable) {
                editable = editor.isEditable
                schedule()
              }
            },
            destroy() {
              cancelAnimationFrame(frame)
              resize.disconnect()
              document.fonts.removeEventListener('loadingdone', fonts)
              document.removeEventListener('selectionchange', selection)
            }
          }
        }
      })
    ]
  }
})
