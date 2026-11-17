import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { type MarkdownCodeBlock, type SourceLine, TOKEN_PLACEHOLDER } from './markdownSession'

type FindCodeLine = (state: EditorState, position: number) => { block: MarkdownCodeBlock; line: SourceLine } | null

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }
const CLOSER_CHARACTERS = new Set(Object.values(CLOSERS))
const CAN_PAIR_BEFORE = /^$|^[\s)\]}:;,]/
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

/** Positions of closers this plugin inserted; only those are stepped over or deleted with their opener. */
const pairKey = new PluginKey<number[]>('composerMarkdownCodePairs')

function readNeighbors(state: EditorState, position: number) {
  const $position = state.doc.resolve(position)
  const { parent, parentOffset } = $position
  return {
    previous: parent.textBetween(Math.max(0, parentOffset - 1), parentOffset, undefined, TOKEN_PLACEHOLDER),
    next: parent.textBetween(
      parentOffset,
      Math.min(parent.content.size, parentOffset + 1),
      undefined,
      TOKEN_PLACEHOLDER
    )
  }
}

function handlePairInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  isCodeLine: (position: number) => boolean
) {
  const { state } = view
  if (view.composing || text.length !== 1 || !isCodeLine(from)) return false
  const closer = CLOSERS[text]

  if (from !== to) {
    if (!closer || !isCodeLine(to)) return false
    const transaction = state.tr.insertText(closer, to).insertText(text, from)
    view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, from + 1, to + 1)).scrollIntoView())
    return true
  }

  const { previous, next } = readNeighbors(state, from)
  if (CLOSER_CHARACTERS.has(text) && next === text && pairKey.getState(state)?.includes(from)) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)).scrollIntoView())
    return true
  }

  const isQuoteAfterWord = text === closer && WORD_CHARACTER.test(previous)
  if (!closer || isQuoteAfterWord || !CAN_PAIR_BEFORE.test(next)) return false

  const transaction = state.tr.insertText(text + closer, from)
  view.dispatch(
    transaction
      .setSelection(TextSelection.create(transaction.doc, from + 1))
      .setMeta(pairKey, from + 1)
      .scrollIntoView()
  )
  return true
}

function handlePairBackspace(view: EditorView, event: KeyboardEvent) {
  if (event.key !== 'Backspace' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
  const { state } = view
  const { empty, from } = state.selection
  if (view.composing || !empty || !pairKey.getState(state)?.includes(from)) return false

  const { previous, next } = readNeighbors(state, from)
  if (CLOSERS[previous] !== next) return false
  view.dispatch(state.tr.delete(from - 1, from + 1).scrollIntoView())
  return true
}

export function createCodePairPlugin(findCodeLine: FindCodeLine) {
  return new Plugin<number[]>({
    key: pairKey,
    state: {
      init: () => [],
      apply: (transaction, closers, _previous, state) => {
        const added = transaction.getMeta(pairKey) as number | undefined
        const { $head } = state.selection
        return [
          ...closers.flatMap((position) => {
            const mapped = transaction.mapping.mapResult(position)
            return mapped.deleted ? [] : [mapped.pos]
          }),
          ...(added === undefined ? [] : [added])
        ].filter((position) => position >= $head.pos && position < $head.end())
      }
    },
    props: {
      handleTextInput: (view, from, to, text) =>
        handlePairInput(view, from, to, text, (position) => {
          const match = findCodeLine(view.state, position)
          return match !== null && match.line !== match.block.open && match.line !== match.block.close
        }),
      handleKeyDown: handlePairBackspace
    }
  })
}
