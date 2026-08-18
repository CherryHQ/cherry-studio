import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type ComposerActivityIndicatorState = string | null

const composerActivityIndicatorKey = new PluginKey<ComposerActivityIndicatorState>('composerActivityIndicator')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composerActivityIndicator: {
      setComposerActivityIndicator: (label?: string) => ReturnType
    }
  }
}

function createActivityIndicator(label: string) {
  const indicator = document.createElement('span')
  indicator.dataset.composerActivityIndicator = ''
  indicator.setAttribute('role', 'status')
  indicator.setAttribute('aria-label', label)
  indicator.setAttribute('contenteditable', 'false')
  indicator.className =
    'ml-1 inline-block size-3 align-[-0.125em] rounded-full border-2 border-current border-r-transparent text-foreground-tertiary motion-safe:animate-spin'
  return indicator
}

export const ComposerActivityIndicator = Extension.create({
  name: 'composerActivityIndicator',

  addCommands() {
    return {
      setComposerActivityIndicator:
        (label) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(composerActivityIndicatorKey, label || null)
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ComposerActivityIndicatorState>({
        key: composerActivityIndicatorKey,
        state: {
          init: () => null,
          apply: (transaction, currentState) => {
            const nextState = transaction.getMeta(composerActivityIndicatorKey)
            return nextState === undefined ? currentState : nextState
          }
        },
        props: {
          decorations: (state) => {
            const activityIndicatorLabel = composerActivityIndicatorKey.getState(state)
            if (!activityIndicatorLabel) return DecorationSet.empty

            const lastInlineNode = state.doc.lastChild?.lastChild
            const trailingWhitespaceLength = lastInlineNode?.isText
              ? (lastInlineNode.text?.match(/\s+$/)?.[0].length ?? 0)
              : 0
            const position = Math.max(0, state.doc.content.size - 1 - trailingWhitespaceLength)
            return DecorationSet.create(state.doc, [
              Decoration.widget(position, () => createActivityIndicator(activityIndicatorLabel), {
                key: 'composerActivityIndicator',
                side: 1
              })
            ])
          }
        }
      })
    ]
  }
})
