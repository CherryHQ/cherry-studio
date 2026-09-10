/**
 * The editor-backed `QuickPanelInputAdapter` — how quick-panel tools write into the composer.
 *
 * Lives outside `ComposerSurfaceRuntime` so both adapters there share one implementation and so the
 * insertion semantics (notably variable tokenization) are testable against a real editor rather
 * than a stub.
 */

import {
  getComposerCursorTextOffset,
  getComposerInputText,
  getComposerPositionAtTextOffset,
  getComposerTextOffset
} from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter, QuickPanelInsertTextOptions } from '@renderer/components/QuickPanel'
import type { Editor, JSONContent } from '@tiptap/core'

import { createComposerPlainTextContent } from './composerTokenMarkers'
import { createPromptVariableInlineContent, getNextPromptVariableIndex } from './promptVariables'
import type { ComposerDraftToken } from './tokens'

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
    getSelectionEndOffset: () => getComposerTextOffset(editor, editor.state.selection.to),
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
