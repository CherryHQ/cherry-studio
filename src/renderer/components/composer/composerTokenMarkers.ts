import type { JSONContent } from '@tiptap/core'

import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerDraftToken } from './tokens'

export interface ComposerTokenMarkerMatch {
  from: number
  to: number
  token: ComposerDraftToken
}

export interface ComposerTokenMarkerRule {
  id: string
  pattern: RegExp
  resolve: (match: RegExpMatchArray) => ComposerTokenMarkerMatch | null
}

interface ResolvedComposerTokenMarker extends ComposerTokenMarkerMatch {
  ruleIndex: number
}

const LINE_BREAK_PATTERN = /\r\n?|\n/

export function createComposerTokenContent(token: ComposerDraftToken): JSONContent {
  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs: token
  }
}

function appendPlainTextContent(content: JSONContent[], text: string) {
  const lines = text.split(LINE_BREAK_PATTERN)
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
  })
}

export function createComposerPlainTextContent(text: string): JSONContent[] {
  const content: JSONContent[] = []
  appendPlainTextContent(content, text)
  return content
}

function collectLineMarkers(line: string, rules: readonly ComposerTokenMarkerRule[]): ResolvedComposerTokenMarker[] {
  const markers: ResolvedComposerTokenMarker[] = []

  rules.forEach((rule, ruleIndex) => {
    for (const match of line.matchAll(rule.pattern)) {
      const marker = rule.resolve(match)
      if (!marker) continue
      if (marker.from < 0 || marker.to <= marker.from || marker.to > line.length) continue
      markers.push({ ...marker, ruleIndex })
    }
  })

  return markers.sort((a, b) => a.from - b.from || a.to - b.to || a.ruleIndex - b.ruleIndex)
}

function appendMarkedLineContent(
  content: JSONContent[],
  line: string,
  rules: readonly ComposerTokenMarkerRule[]
): boolean {
  const markers = collectLineMarkers(line, rules)
  if (!markers.length) {
    if (line) content.push({ type: 'text', text: line })
    return false
  }

  let cursor = 0
  let hasMarker = false
  for (const marker of markers) {
    if (marker.from < cursor) continue

    if (marker.from > cursor) content.push({ type: 'text', text: line.slice(cursor, marker.from) })
    content.push(createComposerTokenContent(marker.token))
    cursor = marker.to
    hasMarker = true
  }

  if (cursor < line.length) content.push({ type: 'text', text: line.slice(cursor) })
  return hasMarker
}

export function createComposerTokenMarkerInlineContent(
  text: string,
  rules: readonly ComposerTokenMarkerRule[]
): { content: JSONContent[]; hasToken: boolean } {
  if (!rules.length) return { content: createComposerPlainTextContent(text), hasToken: false }

  let hasToken = false
  const content = text.split(LINE_BREAK_PATTERN).flatMap<JSONContent>((line, index) => {
    const nodes: JSONContent[] = []
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (appendMarkedLineContent(nodes, line, rules)) hasToken = true
    return nodes
  })

  return { content, hasToken }
}
