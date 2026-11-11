import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { loggerService } from '@logger'
import { codeHighlightService } from '@renderer/services/CodeHighlightService'

import type { MarkdownCodeBlock } from './markdownSession'

const logger = loggerService.withContext('composerCodeHighlight')

type HighlightLines = Awaited<ReturnType<typeof codeHighlightService.highlightRange>>['lines']

const highlightKey = new PluginKey<DecorationSet>('composerMarkdownCodeHighlight')
const blockKey = (block: MarkdownCodeBlock) => `${block.language}\0${block.code}`

let nextOwnerId = 0

function renderBlock(block: MarkdownCodeBlock, lines: HighlightLines) {
  return lines.flatMap((tokens, lineIndex) => {
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
}

/** Colors fenced code through the worker that highlights message code blocks. */
export function createCodeHighlightPlugin(getBlocks: (state: EditorState) => MarkdownCodeBlock[]) {
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
      const owner = `composer-md:${nextOwnerId++}`
      const results = new Map<string, HighlightLines>()
      const pending = new Set<string>()
      let usedSlots = 0
      let appliedKey = ''
      let appliedCount = 0
      let lastBlocks: MarkdownCodeBlock[] | undefined
      let applyQueued = false
      let destroyed = false

      const highlightable = () => getBlocks(view.state).filter((block) => !block.nested && block.codeLines.length > 0)

      const apply = () => {
        // Waiting for every pending block keeps mapped colors on screen instead of flashing them off.
        if (destroyed || view.composing || pending.size > 0) return
        const blocks = highlightable()
        const key = blocks.map(blockKey).join('\0\0')
        // Mapping drops colors when a replace rewrites identical code, so the count is checked too.
        if (key === appliedKey && highlightKey.getState(view.state)?.find().length === appliedCount) return

        const decorations = blocks.flatMap((block) => renderBlock(block, results.get(blockKey(block)) ?? []))
        appliedKey = key
        appliedCount = decorations.length
        view.dispatch(
          view.state.tr
            .setMeta(highlightKey, DecorationSet.create(view.state.doc, decorations))
            .setMeta('addToHistory', false)
        )
      }

      // A plugin view cannot dispatch while the view is still applying the update that called it.
      const scheduleApply = () => {
        if (applyQueued) return
        applyQueued = true
        queueMicrotask(() => {
          applyQueued = false
          apply()
        })
      }

      const sync = () => {
        const rawBlocks = getBlocks(view.state)
        if (destroyed || view.composing || rawBlocks === lastBlocks) return
        lastBlocks = rawBlocks

        const blocks = highlightable()
        usedSlots = Math.max(usedSlots, blocks.length)
        blocks.forEach((block, index) => {
          const key = blockKey(block)
          if (results.has(key) || pending.has(key)) return
          pending.add(key)
          void codeHighlightService
            .highlightRange(block.code, block.language || 'text', '', `${owner}:${index}`, {
              start: 0,
              end: block.codeLines.length
            })
            .then((result) => results.set(key, result.lines))
            .catch((error: Error) => logger.warn('Failed to highlight composer code', error))
            .finally(() => {
              pending.delete(key)
              scheduleApply()
            })
        })

        const liveKeys = new Set(blocks.map(blockKey))
        for (const key of results.keys()) if (!liveKeys.has(key)) results.delete(key)
        scheduleApply()
      }

      sync()
      return {
        update: sync,
        destroy: () => {
          destroyed = true
          for (let index = 0; index < usedSlots; index += 1) codeHighlightService.cleanupTokenizers(`${owner}:${index}`)
        }
      }
    }
  })
}
