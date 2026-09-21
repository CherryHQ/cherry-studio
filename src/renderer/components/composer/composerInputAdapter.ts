/**
 * The editor-backed `QuickPanelInputAdapter` — how quick-panel tools write into the composer.
 *
 * Lives outside `ComposerSurfaceRuntime` so both adapters there share one implementation and so the
 * insertion semantics (notably variable tokenization) are testable against a real editor rather
 * than a stub.
 */

import type { Editor, JSONContent } from '@tiptap/core'

import {
  getComposerCursorTextOffset,
  getComposerInputText,
  getComposerPositionAtTextOffset
} from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter, QuickPanelInsertTextOptions } from '@renderer/components/QuickPanel'

import { serializeComposerDocument } from './composerDraft'
import { createComposerPlainTextContent } from './composerTokenMarkers'
import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import { createPromptVariableInlineContent, getNextPromptVariableIndex } from './promptVariables'
import type { ComposerDraftToken } from './tokens'

export function updateComposerToken(editor: Editor, token: ComposerDraftToken) {
  const transaction = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME && node.attrs.id === token.id) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...token })
    }
  })
  if (transaction.docChanged) editor.view.dispatch(transaction)
}

export function insertComposerTokenAtCursor(
  editor: Editor,
  token: ComposerDraftToken,
  options: { insertSeparator?: boolean } = {}
) {
  const chain = editor.chain().focus().insertComposerToken(token)
  if (options.insertSeparator === false) {
    chain.run()
    return
  }

  chain.insertContent(' ').run()
}

export function deleteComposerTextRange(editor: Editor, range: { from: number; to: number }) {
  const fromOffset = Math.max(0, Math.min(range.from, range.to))
  const toOffset = Math.max(fromOffset, range.to)
  if (fromOffset === toOffset) return

  const from = getComposerPositionAtTextOffset(editor, fromOffset)
  const to = getComposerPositionAtTextOffset(editor, toOffset)
  if (to <= from) return

  editor.chain().focus().deleteRange({ from, to }).run()
}

function getComposerDraftTextOffset(editor: Editor, position: number) {
  const prefix = editor.state.doc.cut(0, Math.max(0, Math.min(position, editor.state.doc.content.size)))
  return serializeComposerDocument(prefix.toJSON()).text.length
}

function getComposerDraftPositionAtTextOffset(editor: Editor, textOffset: number) {
  let low = 0
  let high = editor.state.doc.content.size

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (getComposerDraftTextOffset(editor, middle) < textOffset) low = middle + 1
    else high = middle
  }

  return getComposerDraftTextOffset(editor, low) === textOffset
    ? Math.max(1, Math.min(low, editor.state.doc.content.size))
    : null
}

/**
 * Inline content for an adapter `insertText`. `tokenizeVariables: false` keeps the text literal —
 * the caller owns which spans are fields (see `QuickPanelInsertTextOptions`).
 */
export function buildInsertedInlineContent(
  editor: Editor,
  text: string,
  options?: QuickPanelInsertTextOptions
): JSONContent[] {
  if (options?.tokenizeVariables === false) return createComposerPlainTextContent(text)
  return createPromptVariableInlineContent(text, { startIndex: getNextPromptVariableIndex(editor) })
}

export function createComposerInputAdapter(editor: Editor): QuickPanelInputAdapter {
  return {
    getText: () => getComposerInputText(editor),
    getCursorOffset: () => getComposerCursorTextOffset(editor),
    captureReplaceRange: () => ({
      from: getComposerDraftTextOffset(editor, editor.state.selection.from),
      to: getComposerDraftTextOffset(editor, editor.state.selection.to)
    }),
    replaceRange: (range, text) => {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to < range.from) {
        return false
      }
      const draftLength = serializeComposerDocument(editor).text.length
      if (range.to > draftLength) return false
      const from = getComposerDraftPositionAtTextOffset(editor, range.from)
      const to = getComposerDraftPositionAtTextOffset(editor, range.to)
      if (from === null || to === null || to < from) return false

      return editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .insertContent(buildInsertedInlineContent(editor, text, { tokenizeVariables: false }))
        .run()
    },
    insertText: (insertedText, options) => {
      editor
        .chain()
        .focus()
        .insertContent(buildInsertedInlineContent(editor, insertedText, options))
        .run()
    },
    insertToken: (token, options) => {
      insertComposerTokenAtCursor(editor, token as ComposerDraftToken, options)
    },
    deleteTriggerRange: (range) => {
      deleteComposerTextRange(editor, range)
    },
    focus: () => {
      editor.commands.focus()
    }
  }
}
