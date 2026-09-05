import type { CherryMessagePart } from './types/message'

export const HIDDEN_MARKER_PART_TYPES: ReadonlySet<string> = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

export function isHiddenMarkerPart(part: CherryMessagePart): boolean {
  return HIDDEN_MARKER_PART_TYPES.has(part.type)
}

export function isRenderablePart(part: CherryMessagePart): boolean {
  if (isHiddenMarkerPart(part)) return false
  if (part.type === 'text' || part.type === 'reasoning') return !!part.text?.trim()
  if (part.type === 'file') {
    const p = part as unknown as { url?: string; filename?: string; name?: string }
    return !!p.url?.trim() || !!p.filename?.trim() || !!p.name?.trim()
  }
  if (part.type === 'data-code') {
    const data = (part as unknown as { data?: { content?: string } }).data
    return !!data?.content?.trim()
  }
  if (part.type === 'data-translation') {
    const data = (part as unknown as { data?: { content?: string } }).data
    return !!data?.content?.trim()
  }
  if (part.type === 'data-compact') {
    const data = (part as unknown as { data?: { content?: string; compactedContent?: string } }).data
    return !!data?.content?.trim() || !!data?.compactedContent?.trim()
  }
  if (part.type === 'data-video') {
    const data = (part as unknown as { data?: { url?: string; filePath?: string } }).data
    return !!data?.url?.trim() || !!data?.filePath?.trim()
  }
  return true
}

export function hasRenderableContent(parts: CherryMessagePart[]): boolean {
  return parts.some((part) => isRenderablePart(part))
}
