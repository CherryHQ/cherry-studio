import { LONG_TEXT_PASTE_THRESHOLD } from '@renderer/config/constant'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { ComposerClipboardFragment, ComposerClipboardToken } from '@renderer/utils/message/composerClipboard'
import { createComposerAttachmentFromComposerClipboardToken } from '@renderer/utils/message/composerClipboard'
import type { JSONContent } from '@tiptap/core'

import {
  type ComposerTokenMarkerRule,
  createComposerPlainTextContent,
  createComposerTokenContent,
  createComposerTokenMarkerInlineContent
} from './composerTokenMarkers'
import { createPromptVariableMarkerRule } from './promptVariables'
import type { ComposerDraftToken } from './tokens'

interface ComposerPlainTextPasteOptions {
  promptVariableStartIndex?: number
  resolveSkillMarker?: (marker: string) => ComposerDraftToken | null | undefined
  resolveKnowledgeBaseMarker?: (marker: string) => ComposerDraftToken | null | undefined
}

interface ComposerClipboardPasteOverride {
  content: JSONContent[]
  files: ComposerAttachment[]
}

const SKILL_TOKEN_MARKER_PATTERN = /(^|\s)\/([^/\s]+)\/(?=$|\s)/g
const KNOWLEDGE_BASE_TOKEN_MARKER_PATTERN = /(^|\s)#([^#\r\n]+)#/g

function createSkillMarkerRule(
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
): ComposerTokenMarkerRule {
  return {
    id: 'skill',
    pattern: SKILL_TOKEN_MARKER_PATTERN,
    resolve: (match) => {
      const prefix = match[1] ?? ''
      const marker = match[2]
      const index = match.index ?? 0
      if (!marker) return null

      const token = resolveSkillMarker(marker)
      if (!token) return null

      const markerStart = index + prefix.length
      return { from: markerStart, to: markerStart + marker.length + 2, token }
    }
  }
}

function createKnowledgeBaseMarkerRule(
  resolveKnowledgeBaseMarker: NonNullable<ComposerPlainTextPasteOptions['resolveKnowledgeBaseMarker']>
): ComposerTokenMarkerRule {
  return {
    id: 'knowledge',
    pattern: KNOWLEDGE_BASE_TOKEN_MARKER_PATTERN,
    resolve: (match) => {
      const prefix = match[1] ?? ''
      const marker = match[2]?.trim()
      const index = match.index ?? 0
      if (!marker) return null

      const token = resolveKnowledgeBaseMarker(marker)
      if (!token) return null

      const markerStart = index + prefix.length
      return { from: markerStart, to: markerStart + marker.length + 2, token }
    }
  }
}

export function createComposerPlainTextPasteContent(text: string): JSONContent[] {
  return createComposerPlainTextContent(text)
}

function getPrivateTokenMarker(token: ComposerClipboardToken, prefix: string) {
  return token.id.startsWith(prefix) ? token.id.slice(prefix.length) : token.label
}

function resolvePrivateClipboardToken(
  token: ComposerClipboardToken,
  options: ComposerPlainTextPasteOptions
): { token: ComposerDraftToken; file?: ComposerAttachment } | null {
  if (token.kind === 'skill') {
    const resolvedToken = options.resolveSkillMarker?.(getPrivateTokenMarker(token, 'skill:'))
    return resolvedToken ? { token: resolvedToken } : null
  }

  if (token.kind === 'knowledge') {
    const resolvedToken = options.resolveKnowledgeBaseMarker?.(getPrivateTokenMarker(token, 'knowledge:'))
    return resolvedToken ? { token: resolvedToken } : null
  }

  if (token.kind === 'file') {
    const file = createComposerAttachmentFromComposerClipboardToken(token)
    if (!file) return null

    return {
      token: {
        id: token.id,
        kind: 'file',
        label: token.label,
        payload: file
      },
      file
    }
  }

  if (token.kind === 'quote' || token.kind === 'promptVariable') {
    return {
      token: {
        id: token.id,
        kind: token.kind,
        label: token.label,
        ...(token.description && { description: token.description }),
        ...(token.promptText && { promptText: token.promptText })
      }
    }
  }

  return null
}

export function getComposerClipboardPasteOverride(
  fragment: ComposerClipboardFragment | null,
  options: ComposerPlainTextPasteOptions
): ComposerClipboardPasteOverride | null {
  if (!fragment?.segments.length) return null

  const content: JSONContent[] = []
  const files: ComposerAttachment[] = []

  for (const segment of fragment.segments) {
    if (segment.type === 'text') {
      content.push(...createComposerPlainTextContent(segment.text))
      continue
    }

    const resolved = resolvePrivateClipboardToken(segment.token, options)
    if (!resolved) {
      content.push(...createComposerPlainTextContent(segment.fallbackText))
      continue
    }

    content.push(createComposerTokenContent(resolved.token))
    if (resolved.file) files.push(resolved.file)
  }

  return content.length ? { content, files } : null
}

export function createComposerMarkedTextPasteContent(
  text: string,
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
): JSONContent[] | null {
  const result = createComposerTokenMarkerInlineContent(text, [createSkillMarkerRule(resolveSkillMarker)])

  return result.hasToken ? result.content : null
}

function createPlainTextPasteMarkerRules(options: ComposerPlainTextPasteOptions): ComposerTokenMarkerRule[] {
  const rules = [createPromptVariableMarkerRule({ startIndex: options.promptVariableStartIndex ?? 0 })]

  if (options.resolveKnowledgeBaseMarker) {
    rules.push(createKnowledgeBaseMarkerRule(options.resolveKnowledgeBaseMarker))
  }

  if (options.resolveSkillMarker) {
    rules.push(createSkillMarkerRule(options.resolveSkillMarker))
  }

  return rules
}

export function getComposerPlainTextPasteOverride(text: string, options: ComposerPlainTextPasteOptions) {
  if (!text) return null

  if (text.length > LONG_TEXT_PASTE_THRESHOLD) {
    return null
  }

  const markedTextContent = createComposerTokenMarkerInlineContent(text, createPlainTextPasteMarkerRules(options))
  if (markedTextContent.hasToken) return markedTextContent.content

  return createComposerPlainTextPasteContent(text)
}
