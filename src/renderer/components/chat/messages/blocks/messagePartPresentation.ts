import type { CherryMessagePart } from '@shared/data/types/message'

const HIDDEN_PART_TYPES = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

export function isTimelineMarkerPart(part: CherryMessagePart): boolean {
  return part.type === 'data-compaction-anchor' && part.data.phase !== 'in-loop'
}

export function isHiddenPart(part: CherryMessagePart): boolean {
  return HIDDEN_PART_TYPES.has(part.type)
}
