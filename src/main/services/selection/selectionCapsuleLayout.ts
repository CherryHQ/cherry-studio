import type { Rectangle, Size } from 'electron'

import type { SelectionAgentCapsule, SelectionAgentStatus } from '@shared/types/selection'

/** The host's own padding adds to this, keeping the capsules 12px from the work-area edges. */
const HOST_MARGIN = 4

/** Lower ranks sit nearer the corner: what waits on the user, then what runs, then what has finished. */
const STATUS_RANK: Record<SelectionAgentStatus, number> = {
  'awaiting-approval': 0,
  'needs-input': 0,
  starting: 1,
  running: 1,
  done: 2,
  failed: 2
}

export interface CollapsedSelectionAgent {
  capsule: SelectionAgentCapsule
  collapsedAt: number
}

/** Orders one display's stack nearest the corner first; within a rank, the earlier collapse comes first. */
export function orderSelectionAgentCapsules(stack: CollapsedSelectionAgent[]): SelectionAgentCapsule[] {
  return stack
    .toSorted((a, b) => STATUS_RANK[a.capsule.status] - STATUS_RANK[b.capsule.status] || a.collapsedAt - b.collapsedAt)
    .map(({ capsule }) => capsule)
}

/**
 * Anchors the capsule host to the bottom-right of the work area, which already leaves out the Dock and taskbar.
 * A stack taller than the work area gets the work area's height and scrolls inside it.
 */
export function placeSelectionCapsuleHost(size: Size, workArea: Rectangle): Rectangle {
  const height = Math.min(size.height, workArea.height - 2 * HOST_MARGIN)
  return {
    x: workArea.x + workArea.width - HOST_MARGIN - size.width,
    y: workArea.y + workArea.height - HOST_MARGIN - height,
    width: size.width,
    height
  }
}
