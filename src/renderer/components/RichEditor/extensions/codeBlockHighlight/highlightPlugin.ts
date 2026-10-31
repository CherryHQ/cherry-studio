import { findChildren } from '@tiptap/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { loggerService } from '@logger'
import { codeHighlightService } from '@renderer/services/CodeHighlightService'
import { uuid } from '@renderer/utils/uuid'

const logger = loggerService.withContext('RichEditor:CodeBlockHighlight')
export const codeHighlightPluginKey = new PluginKey<DecorationSet>('codeHighlight')
interface Block {
  pos: number
  node: ProsemirrorNode
  language: string
  callerId: string
  requested?: ProsemirrorNode
  decorations: { from: number; to: number; className: string }[]
}

export function HighlightPlugin({
  name,
  defaultLanguage
}: {
  name: string
  defaultLanguage: string | null | undefined
}) {
  let blocks: Block[] = []
  const reconcile = (doc: ProsemirrorNode, transaction?: Transaction) => {
    const previous = new Map<number, Block>()
    for (const block of blocks) {
      const mapped = transaction?.mapping.mapResult(block.pos, 1)
      if (!mapped?.deleted) previous.set(mapped?.pos ?? block.pos, block)
    }
    const next = findChildren(doc, (node) => node.type.name === name).map(({ pos, node }) => {
      const language = node.attrs.language || defaultLanguage || 'text'
      let block = previous.get(pos)
      if (block?.language !== language) block = undefined
      if (!block) block = { pos, node, language, callerId: `tiptap:${uuid()}`, decorations: [] }
      if (!node.eq(block.node)) block.decorations = []
      block.pos = pos
      block.node = node
      return block
    })
    const retained = new Set(next)
    for (const block of blocks) if (!retained.has(block)) codeHighlightService.cleanupTokenizers(block.callerId)
    blocks = next
  }
  const decorate = (doc: ProsemirrorNode) =>
    DecorationSet.create(
      doc,
      blocks.flatMap((block) =>
        block.decorations.map(({ from, to, className }) =>
          Decoration.inline(block.pos + 1 + from, block.pos + 1 + to, { class: className })
        )
      )
    )

  return new Plugin<DecorationSet>({
    key: codeHighlightPluginKey,
    state: {
      init: (_, { doc }) => {
        reconcile(doc)
        return DecorationSet.empty
      },
      apply: (transaction, decorations) => {
        if (transaction.docChanged) reconcile(transaction.doc, transaction)
        return transaction.docChanged || transaction.getMeta(codeHighlightPluginKey) === true
          ? decorate(transaction.doc)
          : decorations
      }
    },
    view: (view) => {
      let destroyed = false
      const highlight = () => {
        for (const block of blocks) {
          if (block.requested?.eq(block.node)) continue
          const node = block.node
          block.requested = node
          const source = node.textContent
          void codeHighlightService
            .highlightRange(source, block.language, '', block.callerId, { start: 0, end: source.split('\n').length })
            .then((result) => {
              if (destroyed || !blocks.includes(block) || !block.node.eq(node)) return
              let offset = 0
              block.decorations = result.lines.flatMap((line) => {
                const spans = line.flatMap((token) =>
                  token.className && token.content.length
                    ? [
                        {
                          from: offset + token.offset,
                          to: offset + token.offset + token.content.length,
                          className: token.className
                        }
                      ]
                    : []
                )
                offset += line.reduce((length, token) => length + token.content.length, 0) + 1
                return spans
              })
              view.dispatch(view.state.tr.setMeta(codeHighlightPluginKey, true).setMeta('addToHistory', false))
            })
            .catch((error) => logger.warn('Failed to highlight code block', error))
        }
      }
      highlight()
      return {
        update: highlight,
        destroy: () => {
          destroyed = true
          for (const block of blocks) codeHighlightService.cleanupTokenizers(block.callerId)
          blocks = []
        }
      }
    },
    props: { decorations: (state) => codeHighlightPluginKey.getState(state) }
  })
}
