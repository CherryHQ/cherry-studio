import { Extension, type JSONContent } from '@tiptap/core'
import { Fragment, type Schema, Slice } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'

import { serializeComposerDocument } from './composerDraft'
import { createComposerLineParagraphs } from './composerTokenMarkers'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composerLines: {
      /** Ends the current source line at the selection, replacing any selected content. */
      splitComposerLine: () => ReturnType
      /** Replaces the selection with an inline stream, one paragraph per source line. */
      insertComposerLines: (content: readonly JSONContent[]) => ReturnType
    }
  }
}

/** The slice is open so its first and last lines merge into the text around the insertion point. */
export function createComposerLineSlice(schema: Schema, content: readonly JSONContent[]): Slice {
  const paragraphs = createComposerLineParagraphs(content).map((node) => schema.nodeFromJSON(node))
  return new Slice(Fragment.fromArray(paragraphs), 1, 1)
}

function foldHardBreaks(state: EditorState) {
  const breaks: number[] = []
  state.doc.descendants((node, position) => {
    if (node.type.name === 'hardBreak') breaks.push(position)
  })
  if (breaks.length === 0) return null

  const transaction = state.tr
  // Splitting before deleting keeps a caret on either side of the break on its own line.
  breaks.reverse().forEach((position) => transaction.split(position + 1).delete(position, position + 1))
  return transaction
}

/** Keeps the document at one paragraph per source line, which lets decorations span whole lines. */
export const ComposerLines = Extension.create({
  name: 'composerLines',

  addCommands() {
    return {
      splitComposerLine:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            if (!tr.selection.empty) tr.deleteSelection()
            tr.split(tr.selection.from).scrollIntoView()
          }
          return true
        },
      insertComposerLines:
        (content) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.replaceSelection(createComposerLineSlice(tr.doc.type.schema, content))
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('composerLines'),
        // A break that arrives during composition stays until the next document change.
        appendTransaction: (transactions, _oldState, state) =>
          !this.editor.view.composing && transactions.some((transaction) => transaction.docChanged)
            ? foldHardBreaks(state)
            : null,
        props: {
          // Tiptap's default puts a blank line between blocks, but each block here is one source line.
          clipboardTextSerializer: (slice) =>
            serializeComposerDocument({ type: 'doc', content: slice.content.toJSON() ?? [] }).text
        }
      })
    ]
  }
})
