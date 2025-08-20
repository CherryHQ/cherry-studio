import { loggerService } from '@logger'
// Cache highlighter instance once initialized so that decoration computation can run synchronously.
import type { HighlighterGeneric } from 'shiki/core'
let cachedHighlighter: HighlighterGeneric<any, any> | null = null
import { getHighlighter, loadLanguageIfNeeded, loadThemeIfNeeded } from '@renderer/utils/shiki'
import { findChildren } from '@tiptap/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, PluginView } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const logger = loggerService.withContext('RichEditor:CodeBlockShiki')

// Languages that should skip syntax highlighting entirely
const SKIP_HIGHLIGHTING_LANGUAGES = new Set(['text', 'plain', 'plaintext', 'txt', '', null, undefined])

function getDecorations({
  doc,
  name,
  defaultLanguage,
  theme = 'one-light'
}: {
  doc: ProsemirrorNode
  name: string
  defaultLanguage: string | null | undefined
  theme?: string
}) {
  const highlighter = cachedHighlighter

  if (!highlighter) {
    return DecorationSet.empty
  }

  const decorations: Decoration[] = []

  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    let from = block.pos + 1
    const language = block.node.attrs.language || defaultLanguage || 'text'
    const code = block.node.textContent

    // Skip completely empty code blocks (no content at all)
    if (!code) return

    // Skip highlighting for plain text languages
    if (SKIP_HIGHLIGHTING_LANGUAGES.has(language)) {
      return
    }

    try {
      const loadedLanguages = highlighter.getLoadedLanguages()

      if (!loadedLanguages.includes(language)) {
        return
      }

      const tokens = highlighter.codeToTokens(code, {
        lang: language,
        theme
      })

      for (const line of tokens.tokens) {
        for (const token of line) {
          const to = from + token.content.length

          if (token.color) {
            decorations.push(
              Decoration.inline(from, to, {
                style: `color: ${token.color}`
              })
            )
          }

          from = to
        }
        // account for the line break character ("\n") that follows each line
        from += 1
      }
    } catch (error) {
      logger.warn('Failed to highlight code block:', error as Error)
    }
  })

  return DecorationSet.create(doc, decorations)
}

export function ShikiPlugin({
  name,
  defaultLanguage,
  theme
}: {
  name: string
  defaultLanguage: string | null | undefined
  theme?: string
}) {
  const shikiPlugin: Plugin<any> = new Plugin({
    key: new PluginKey('shiki'),

    state: {
      init: (_, { doc }) => {
        return getDecorations({
          doc,
          name,
          defaultLanguage,
          theme
        })
      },
      apply: (transaction, decorationSet, oldState, newState) => {
        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name
        const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name)
        const newNodes = findChildren(newState.doc, (node) => node.type.name === name)

        const didChangeSomeCodeBlock =
          transaction.docChanged &&
          // Apply decorations if:
          // selection includes named node,
          ([oldNodeName, newNodeName].includes(name) ||
            // OR transaction adds/removes named node,
            newNodes.length !== oldNodes.length ||
            // OR transaction has changes that completely encapsulate a node
            // (for example, a transaction that affects the entire document).
            // Such transactions can happen during collab syncing via y-prosemirror, for example.
            transaction.steps.some((step) => {
              // @ts-ignore: ProseMirror step types are complex to type properly
              return (
                // @ts-ignore: ProseMirror step types are complex to type properly
                step.from !== undefined &&
                // @ts-ignore: ProseMirror step types are complex to type properly
                step.to !== undefined &&
                oldNodes.some((node) => {
                  // @ts-ignore: ProseMirror step types are complex to type properly
                  return (
                    // @ts-ignore: ProseMirror step types are complex to type properly
                    node.pos >= step.from &&
                    // @ts-ignore: ProseMirror step types are complex to type properly
                    node.pos + node.node.nodeSize <= step.to
                  )
                })
              )
            }))

        if (didChangeSomeCodeBlock || transaction.getMeta('shikiHighlighterReady')) {
          return getDecorations({
            doc: transaction.doc,
            name,
            defaultLanguage,
            theme
          })
        }

        return decorationSet.map(transaction.mapping, transaction.doc)
      }
    },

    view: (view) => {
      class ShikiPluginView implements PluginView {
        private highlighter: HighlighterGeneric<any, any> | null = null
        constructor() {
          this.initDecorations()
        }

        update() {
          this.checkUndecoratedBlocks()
        }

        destroy() {
          this.highlighter = null
          cachedHighlighter = null
        }

        async initDecorations() {
          this.highlighter = await getHighlighter()
          cachedHighlighter = this.highlighter
          const tr = view.state.tr.setMeta('shikiHighlighterReady', true)
          view.dispatch(tr)
        }

        async checkUndecoratedBlocks() {
          // If highlighter is not yet initialized, defer processing until it becomes available.
          if (!this.highlighter) {
            return
          }

          const codeBlocks = findChildren(view.state.doc, (node) => node.type.name === name)

          // Only load themes or languages that the highlighter has not seen yet.
          const tasks: Promise<void>[] = []
          let didLoadSomething = false

          for (const block of codeBlocks) {
            // Skip completely empty code blocks in loading check too
            if (!block.node.textContent) continue

            const { theme: blockTheme, language: blockLanguage } = block.node.attrs

            // Skip loading for plain text languages
            if (SKIP_HIGHLIGHTING_LANGUAGES.has(blockLanguage)) {
              continue
            }

            if (blockTheme && !this.highlighter.getLoadedThemes().includes(blockTheme)) {
              tasks.push(
                loadThemeIfNeeded(this.highlighter, blockTheme).then(() => {
                  didLoadSomething = true
                })
              )
            }

            if (blockLanguage && !this.highlighter.getLoadedLanguages().includes(blockLanguage)) {
              tasks.push(
                loadLanguageIfNeeded(this.highlighter, blockLanguage).then(() => {
                  didLoadSomething = true
                })
              )
            }
          }

          await Promise.all(tasks)

          if (didLoadSomething) {
            const tr = view.state.tr.setMeta('shikiHighlighterReady', true)
            view.dispatch(tr)
          }
        }
      }

      return new ShikiPluginView()
    },

    props: {
      decorations(state) {
        return shikiPlugin.getState(state)
      }
    }
  })

  return shikiPlugin
}
