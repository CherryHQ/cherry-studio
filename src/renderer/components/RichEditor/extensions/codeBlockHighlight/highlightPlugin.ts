import { findChildren } from '@tiptap/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import {
  getTokenStyle,
  loadCodeHighlightRuntime,
  supportsCodeLanguage,
  type HighlightDocument,
  type Theme
} from '@cherrystudio/ui/code-highlight'
import { loggerService } from '@logger'
import { loadCodeTheme } from '@renderer/utils/codeHighlight'

const logger = loggerService.withContext('RichEditor:CodeBlockHighlight')
export const codeHighlightPluginKey = new PluginKey<DecorationSet>('codeHighlight')
interface Block {
  pos: number
  node: ProsemirrorNode
  language: string
  document: HighlightDocument
  decorations: { from: number; to: number; style: string }[]
}

export function HighlightPlugin({
  name,
  defaultLanguage,
  theme = 'one-light'
}: {
  name: string
  defaultLanguage: string | null | undefined
  theme?: string
}) {
  let runtime: Awaited<ReturnType<typeof loadCodeHighlightRuntime>> | undefined
  let resolvedTheme: Theme | undefined
  let requestedTheme = theme
  let loadedTheme: string | undefined
  let blocks: Block[] = []

  const decorate = (doc: ProsemirrorNode, transaction: Transaction): DecorationSet => {
    if (!runtime || !resolvedTheme) return DecorationSet.empty
    const previous = new Map<number, Block>()
    for (const block of blocks) {
      const mapped = transaction.mapping.mapResult(block.pos, 1)
      if (!mapped.deleted) previous.set(mapped.pos, block)
    }
    const next: Block[] = []
    const decorations: Decoration[] = []
    for (const { node, pos } of findChildren(doc, (node) => node.type.name === name)) {
      const language = node.attrs.language || defaultLanguage || 'text'
      if (!supportsCodeLanguage(language)) continue
      let block = previous.get(pos)
      if (block?.language !== language) block = undefined
      if (!block) {
        block = {
          pos,
          node,
          language,
          document: runtime.createDocument(node.textContent, language, resolvedTheme),
          decorations: []
        }
      } else if (!node.eq(block.node)) {
        const start = block.node.content.findDiffStart(node.content)
        const end = block.node.content.findDiffEnd(node.content)
        if (start !== null && end) {
          const overlap = Math.max(0, start - Math.min(end.a, end.b))
          const position = (offset: number) => {
            const lines = block!.node.textContent.slice(0, offset).split('\n')
            return { line: lines.length - 1, character: lines.at(-1)!.length }
          }
          block.document.update({
            type: 'edits',
            edits: [
              {
                range: { start: position(start), end: position(end.a + overlap) },
                newText: node.textContent.slice(start, end.b + overlap)
              }
            ]
          })
        }
        block.decorations = []
      }
      if (!block.decorations.length) {
        let from = 0
        for (const line of block.document.read({ start: 0, end: block.document.lineCount }).lines) {
          for (const token of line) {
            const to = from + token.content.length
            const style = Object.entries(
              getTokenStyle(token, {
                isDarkTheme: resolvedTheme.appearance === 'dark',
                foreground: 'var(--foreground)'
              })
            )
              .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
              .join(';')
            if (to > from && style) block.decorations.push({ from, to, style })
            from = to
          }
          from++
        }
      }
      block.pos = pos
      block.node = node
      next.push(block)
      for (const decoration of block.decorations)
        decorations.push(
          Decoration.inline(pos + 1 + decoration.from, pos + 1 + decoration.to, { style: decoration.style })
        )
    }
    const retained = new Set(next)
    for (const block of blocks) if (!retained.has(block)) block.document.dispose()
    blocks = next
    return DecorationSet.create(doc, decorations)
  }
  const clear = () => {
    for (const block of blocks) block.document.dispose()
    blocks = []
  }
  return new Plugin<DecorationSet>({
    key: codeHighlightPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, decorations) => {
        const meta: unknown = transaction.getMeta(codeHighlightPluginKey)
        if (typeof meta === 'string') requestedTheme = meta
        if (meta === true || transaction.docChanged) return decorate(transaction.doc, transaction)
        return decorations
      }
    },
    view: (view) => {
      let destroyed = false
      let loading: string | undefined
      const configure = () => {
        if (loading === requestedTheme || loadedTheme === requestedTheme) return
        const selected = requestedTheme
        loading = selected
        void Promise.all([loadCodeHighlightRuntime(), loadCodeTheme(selected)])
          .then(([engine, selectedTheme]) => {
            if (destroyed || requestedTheme !== selected) return
            runtime = engine
            resolvedTheme = selectedTheme
            loadedTheme = selected
            clear()
            view.dispatch(view.state.tr.setMeta(codeHighlightPluginKey, true).setMeta('addToHistory', false))
          })
          .catch((error) => logger.warn('Failed to initialize code highlighting', error))
          .finally(() => {
            if (loading === selected) loading = undefined
          })
      }
      configure()
      return {
        update: configure,
        destroy: () => {
          destroyed = true
          clear()
          runtime = undefined
          resolvedTheme = undefined
        }
      }
    },
    props: { decorations: (state) => codeHighlightPluginKey.getState(state) }
  })
}
