import { HIDDEN_MARKER_PART_TYPES } from '@shared/ai/messageRenderability'
import type { CherryMessagePart } from '@shared/data/types/message'

export function isTimelineMarkerPart(part: CherryMessagePart): boolean {
  return part.type === 'data-compaction-anchor' && part.data.phase !== 'in-loop'
}

export function isHiddenPart(part: CherryMessagePart): boolean {
  return HIDDEN_MARKER_PART_TYPES.has(part.type)
}
