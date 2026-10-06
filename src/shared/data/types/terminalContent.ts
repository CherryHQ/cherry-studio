/**
 * Terminal-state content classification for persisted assistant turns.
 *
 * A turn can settle with no renderable content even though the provider was
 * paid for the request (usage carries real token counts). Persisting that as a
 * silent `success` is indistinguishable from a working turn that produced
 * nothing the user asked for, so both conditions are detected here and routed
 * to an explicit classified error instead. See §Terminal invariants.
 */

import type { CherryMessagePart } from './message'

/**
 * Part types that make a turn answerable to the user.
 *
 * Deliberately excludes `data-*`: those are service/control parts
 * (compaction anchors, task events, errors themselves) that render no answer.
 * Also excludes `step-start` and `source-url` (plus `source-document`, which is
 * not listed here): the renderer hides all of them (`HIDDEN_PART_TYPES` in
 * `messagePartLayouts.ts`), so a turn made only of them renders nothing.
 */
const CONTENT_PART_PREFIXES = ['text', 'reasoning', 'file'] as const
const CONTENT_PART_EXACT = new Set(['dynamic-tool'])

export function isContentPart(part: Pick<CherryMessagePart, 'type'>): boolean {
  const { type } = part
  if (CONTENT_PART_EXACT.has(type)) return true
  if (type.startsWith('tool-')) return true
  return CONTENT_PART_PREFIXES.some((prefix) => type === prefix)
}

export function hasTurnContent(parts: ReadonlyArray<Pick<CherryMessagePart, 'type'>> | undefined): boolean {
  return parts?.some(isContentPart) === true
}

/**
 * A part that carries user-visible rendered content.
 *
 * Same membership as {@link isContentPart}, narrowed to the value-holding types
 * so callers can read `text` without re-checking the shape.
 */
export type ContentPart = CherryMessagePart & { type: string; text?: string }

export function isRenderedContentPart(part: CherryMessagePart): part is ContentPart {
  return isContentPart(part)
}
