import type { Editor, JSONContent } from '@tiptap/core'

import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import { COMPOSER_TOKEN_NODE_NAME, normalizeComposerTokenAttrs } from './tokens'

type ComposerSerializableSource = Pick<Editor, 'getJSON'> | JSONContent

function isEditorSource(source: ComposerSerializableSource): source is Pick<Editor, 'getJSON'> {
  return typeof (source as Pick<Editor, 'getJSON'>).getJSON === 'function'
}

function getRestoredTextSuffix(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return ''

  const restoredTextSuffix = (payload as Record<string, unknown>).restoredTextSuffix
  return typeof restoredTextSuffix === 'string' ? restoredTextSuffix : ''
}

export function serializeComposerDocument(source: ComposerSerializableSource): ComposerSerializedDraft {
  const json = isEditorSource(source) ? source.getJSON() : source
  const tokens: ComposerSerializedToken[] = []
  let text = ''

  const visitNode = (node: JSONContent) => {
    if (node.type === 'text') {
      text += node.text ?? ''
      return
    }

    if (node.type === 'hardBreak') {
      text += '\n'
      return
    }

    if (node.type === COMPOSER_TOKEN_NODE_NAME) {
      const token = normalizeComposerTokenAttrs(node.attrs ?? {})
      const restoredTextSuffix = getRestoredTextSuffix(token.payload)
      tokens.push({
        ...token,
        index: tokens.length,
        textOffset: text.length
      })
      text += token.promptText ?? ''
      text += restoredTextSuffix
      return
    }

    if (!node.content?.length) return

    if (node.type === 'doc') {
      node.content.forEach((child, index) => {
        if (index > 0) text += '\n'
        visitNode(child)
      })
      return
    }

    node.content.forEach(visitNode)
  }

  visitNode(json)

  return { text, tokens }
}

/** Mirrors the serialized draft exactly, including block separators and restored token suffixes. */
export function getComposerSerializedTextLength(source: ComposerSerializableSource): number {
  return serializeComposerDocument(source).text.length
}
