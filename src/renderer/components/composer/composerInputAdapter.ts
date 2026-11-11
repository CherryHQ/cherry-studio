/**
 * The editor-backed `QuickPanelInputAdapter` — how quick-panel tools write into the composer.
 *
 * Lives outside `ComposerSurfaceRuntime` so both adapters there share one implementation and so the
 * insertion semantics (notably variable tokenization) are testable against a real editor rather
 * than a stub.
 */

import { type Editor, type JSONContent, selectionToInsertionEnd } from '@tiptap/core'

import {
  getComposerCursorTextOffset,
  getComposerInputText,
  getComposerPositionAtTextOffset,
  getComposerTextOffset
} from '@renderer/components/composer/quickPanel'
import type { QuickPanelInputAdapter, QuickPanelInsertTextOptions } from '@renderer/components/QuickPanel'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from './composerDraft'
import { createComposerLineSlice } from './composerLines'
import { createComposerPlainTextContent } from './composerTokenMarkers'
import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import { hasMarkdownLivePreview, isMarkdownFencedCodePosition } from './markdownLivePreview/livePreviewPlugin'
import {
  createPromptVariableInlineContent,
  getNextPromptVariableIndex,
  PROMPT_VARIABLE_TOKENIZATION_META
} from './promptVariables'
import type { ComposerDraftToken } from './tokens'

export function appendComposerText(editor: Editor, text: string): boolean {
  if (editor.isDestroyed) return false
  if (!text) return true
  const current = serializeComposerDocument(editor).text
  const appended = current ? `\n${text}` : text
  const end = editor.state.doc.content.size - 1
  const transaction = editor.state.tr
    .replaceRange(end, end, createComposerLineSlice(editor.schema, createComposerPlainTextContent(appended)))
    .setMeta(PROMPT_VARIABLE_TOKENIZATION_META, false)
  selectionToInsertionEnd(transaction, 0, -1)
  editor.view.dispatch(transaction)
  return true
}

export function updateComposerToken(editor: Editor, token: ComposerDraftToken) {
  const transaction = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME && node.attrs.id === token.id) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...token })
    }
  })
  if (transaction.docChanged) editor.view.dispatch(transaction)
}

/**
 * Restored drafts can carry an older serialized label for the same token. Refresh only the display
 * label in place, preserving the stored prompt text and the token's document position.
 */
export function refreshComposerTokenLabel(editor: Editor, token: ComposerDraftToken) {
  const transaction = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME && node.attrs.id === token.id && node.attrs.label !== token.label) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, label: token.label })
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

export function insertKnowledgeBaseTokenAtStart(editor: Editor, token: ComposerDraftToken) {
  if (editor.isDestroyed || token.kind !== 'knowledge') return false

  const currentTextLength = serializeComposerDocument(editor).text.length
  if (currentTextLength + (token.promptText?.length ?? 0) + 1 > COMPOSER_INPUT_MAX_LENGTH) return false

  const paragraph = editor.state.doc.firstChild
  let position = 1
  let foundKnowledgeToken = false

  if (paragraph) {
    for (let index = 0; index < paragraph.childCount; index += 1) {
      const child = paragraph.child(index)
      if (child.type.name === COMPOSER_TOKEN_NODE_NAME && child.attrs.kind === 'knowledge') {
        position += child.nodeSize
        foundKnowledgeToken = true
      } else if (foundKnowledgeToken && child.isText && child.text?.startsWith(' ')) {
        position += 1
        break
      } else {
        break
      }
    }
  }

  editor
    .chain()
    .insertContentAt(
      position,
      [
        { type: COMPOSER_TOKEN_NODE_NAME, attrs: token },
        { type: 'text', text: ' ' }
      ],
      { updateSelection: false }
    )
    .run()
  return true
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
  const { state } = editor
  if (options?.tokenizeVariables === false || isMarkdownFencedCodePosition(state, state.selection.from)) {
    return createComposerPlainTextContent(text)
  }
  return createPromptVariableInlineContent(text, {
    startIndex: getNextPromptVariableIndex(editor),
    literalFencedCode: hasMarkdownLivePreview(state)
  })
}

export function createComposerInputAdapter(editor: Editor): QuickPanelInputAdapter {
  return {
    getText: () => getComposerInputText(editor),
    getCursorOffset: () => getComposerCursorTextOffset(editor),
    getSelectionEndOffset: () => getComposerTextOffset(editor, editor.state.selection.to),
    captureReplaceRange: () => ({
      from: editor.state.selection.from,
      to: editor.state.selection.to
    }),
    replaceRange: (range, text) => {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to < range.from) {
        return false
      }
      if (range.to > editor.state.doc.content.size) return false
      const slice = createComposerLineSlice(
        editor.schema,
        buildInsertedInlineContent(editor, text, { tokenizeVariables: false })
      )
      const transaction = editor.state.tr
        .replaceRange(range.from, range.to, slice)
        .setMeta(PROMPT_VARIABLE_TOKENIZATION_META, false)
      if (serializeComposerDocument(transaction.doc.toJSON()).text.length > COMPOSER_INPUT_MAX_LENGTH) return false
      selectionToInsertionEnd(transaction, 0, -1)
      editor.view.dispatch(transaction)
      editor.commands.focus()
      return true
    },
    insertText: (insertedText, options) => {
      const chain = editor
        .chain()
        .focus()
        .setMeta(PROMPT_VARIABLE_TOKENIZATION_META, options?.tokenizeVariables !== false)
      const content = buildInsertedInlineContent(editor, insertedText, options)
      if (options?.position === 'start') chain.insertContentAt(1, content).run()
      else chain.insertComposerLines(content).run()
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
