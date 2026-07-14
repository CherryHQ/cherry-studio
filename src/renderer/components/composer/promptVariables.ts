import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, type Selection } from '@tiptap/pm/state'

import { type ComposerTokenMarkerRule, createComposerTokenMarkerInlineContent } from './composerTokenMarkers'
import { COMPOSER_TOKEN_NODE_NAME, requestComposerPromptVariableEdit } from './ComposerTokenNode'
import type { ComposerDraftToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

export type PromptVariableSegment =
  | { type: 'text'; text: string }
  | { type: 'variable'; index: number; raw: string; variableName: string }

const PROMPT_VARIABLE_PATTERN = /\$\{([^}\r\n]+)\}/g
const PROMPT_VARIABLE_ID_PATTERN = /^prompt-variable:(\d+):/

function pushTextSegment(segments: PromptVariableSegment[], text: string) {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous?.type === 'text') {
    previous.text += text
    return
  }
  segments.push({ type: 'text', text })
}

export function parsePromptVariableSegments(text: string): PromptVariableSegment[] {
  const segments: PromptVariableSegment[] = []
  let cursor = 0
  let variableIndex = 0

  for (const match of text.matchAll(PROMPT_VARIABLE_PATTERN)) {
    const raw = match[0]
    const matchIndex = match.index ?? 0
    const variableName = match[1]?.trim() ?? ''

    if (!variableName) continue

    pushTextSegment(segments, text.slice(cursor, matchIndex))
    segments.push({ type: 'variable', index: variableIndex, raw, variableName })
    variableIndex += 1
    cursor = matchIndex + raw.length
  }

  pushTextSegment(segments, text.slice(cursor))
  return segments.length ? segments : [{ type: 'text', text }]
}

export function createPromptVariableToken(variableName: string, raw: string, index: number): ComposerDraftToken {
  return {
    id: `prompt-variable:${index}:${variableName}`,
    kind: 'promptVariable',
    label: variableName,
    description: raw,
    promptText: raw,
    payload: { raw, variableName }
  }
}

export function createPromptVariableMarkerRule(options: { startIndex?: number } = {}): ComposerTokenMarkerRule {
  const startIndex = options.startIndex ?? 0
  let variableIndex = 0

  return {
    id: 'promptVariable',
    pattern: PROMPT_VARIABLE_PATTERN,
    resolve: (match) => {
      const raw = match[0]
      const matchIndex = match.index ?? 0
      const variableName = match[1]?.trim() ?? ''
      if (!raw || !variableName) return null

      const token = createPromptVariableToken(variableName, raw, startIndex + variableIndex)
      variableIndex += 1
      return { from: matchIndex, to: matchIndex + raw.length, token }
    }
  }
}

function readPromptVariableIndex(token: ComposerDraftToken): number | undefined {
  if (token.kind !== 'promptVariable') return undefined
  const match = PROMPT_VARIABLE_ID_PATTERN.exec(token.id)
  if (!match) return undefined

  const index = Number.parseInt(match[1], 10)
  return Number.isFinite(index) ? index : undefined
}

export function getNextPromptVariableIndex(editor: Editor): number {
  let nextIndex = 0

  editor.state.doc.descendants((node) => {
    if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return
    const token = normalizeComposerTokenAttrs(node.attrs)
    const index = readPromptVariableIndex(token)
    if (index !== undefined) nextIndex = Math.max(nextIndex, index + 1)
  })

  return nextIndex
}

export function createPromptVariableInlineContent(text: string, options: { startIndex?: number } = {}): JSONContent[] {
  const startIndex = options.startIndex ?? 0
  return createComposerTokenMarkerInlineContent(text, [createPromptVariableMarkerRule({ startIndex })]).content
}

export function createPromptVariableContent(text: string): JSONContent {
  const content = createPromptVariableInlineContent(text)

  return {
    type: 'doc',
    content: [{ type: 'paragraph', ...(content.length > 0 && { content }) }]
  }
}

export function tokenizePromptVariablesInEditor(editor: Editor): boolean {
  const replacements: Array<{ from: number; to: number; token: ComposerDraftToken }> = []
  let variableIndex = getNextPromptVariableIndex(editor)

  editor.state.doc.descendants((node, position) => {
    if (!node.isText) return
    const text = node.text ?? ''
    const segments = parsePromptVariableSegments(text)
    let offset = 0

    for (const segment of segments) {
      if (segment.type === 'text') {
        offset += segment.text.length
        continue
      }

      replacements.push({
        from: position + offset,
        to: position + offset + segment.raw.length,
        token: createPromptVariableToken(segment.variableName, segment.raw, variableIndex)
      })
      variableIndex += 1
      offset += segment.raw.length
    }
  })

  if (!replacements.length) return false

  const tokenNodeType = editor.schema.nodes[COMPOSER_TOKEN_NODE_NAME]
  if (!tokenNodeType) return false

  const transaction = editor.state.tr
  for (const replacement of replacements.reverse()) {
    transaction.replaceWith(replacement.from, replacement.to, tokenNodeType.create(replacement.token))
  }

  if (!transaction.docChanged) return false
  editor.view.dispatch(transaction)
  return true
}

function getSelectionNode(selection: Selection): ProseMirrorNode | null {
  if (selection instanceof NodeSelection) return selection.node
  if (!('node' in selection)) return null
  return selection.node as ProseMirrorNode
}

export function getSelectedPromptVariableToken(editor: Editor) {
  const selection = editor.state.selection
  const node = getSelectionNode(selection)
  if (!node) return null
  if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return null

  const token = normalizeComposerTokenAttrs(node.attrs)
  if (token.kind !== 'promptVariable') return null

  return {
    position: selection.from,
    token
  }
}

export function selectPromptVariableToken(editor: Editor, direction: 1 | -1): ComposerDraftToken | null {
  const tokens: Array<{ position: number; token: ComposerDraftToken }> = []

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== COMPOSER_TOKEN_NODE_NAME) return
    const token = normalizeComposerTokenAttrs(node.attrs)
    if (token.kind === 'promptVariable') tokens.push({ position, token })
  })

  if (!tokens.length) return null

  const currentPosition = editor.state.selection.from
  const currentIndex = tokens.findIndex((token) => token.position === currentPosition)
  const nextIndex =
    direction > 0
      ? currentIndex >= 0
        ? (currentIndex + 1) % tokens.length
        : Math.max(
            0,
            tokens.findIndex((token) => token.position > currentPosition)
          )
      : currentIndex >= 0
        ? (currentIndex - 1 + tokens.length) % tokens.length
        : tokens.findLastIndex((token) => token.position < currentPosition)

  const target = tokens[nextIndex >= 0 ? nextIndex : tokens.length - 1]
  editor.chain().focus().setNodeSelection(target.position).run()
  if (editor.commands?.editComposerToken) {
    editor.commands.editComposerToken(target.token.id, target.position)
  } else {
    requestComposerPromptVariableEdit(editor.view?.dom, target.token.id, target.position)
  }
  return target.token
}

export function updateSelectedPromptVariableToken(editor: Editor, nextValue: string): boolean {
  const selected = getSelectedPromptVariableToken(editor)
  if (!selected) return false

  const selection = editor.state.selection
  const node = getSelectionNode(selection)
  if (!node) return false
  const nextLabel = nextValue || selected.token.label
  const transaction = editor.state.tr.setNodeMarkup(selected.position, undefined, {
    ...node.attrs,
    label: nextLabel,
    promptText: nextValue
  })
  if (selection instanceof NodeSelection) {
    transaction.setSelection(NodeSelection.create(transaction.doc, selected.position))
  }
  editor.view.dispatch(transaction)
  return true
}
