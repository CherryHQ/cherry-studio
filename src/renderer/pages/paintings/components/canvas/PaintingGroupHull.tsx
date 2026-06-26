import { cn } from '@renderer/utils/style'
import type { Node, NodeProps } from '@xyflow/react'
import { memo } from 'react'

export interface PaintingGroupHullData extends Record<string, unknown> {
  /** The group's shared `group_id` — used to move every member on hull drag. */
  groupId: string
  /** Prompt label shown on the hull header (all members share it). */
  prompt: string
}

export type PaintingGroupHullType = Node<PaintingGroupHullData, 'groupHull'>

/**
 * Derived backdrop behind the members of a multi-image group (the bounding box
 * of paintings sharing a `group_id`). It owns no data of its own — dragging it
 * moves every member together; its frame is the only grab area not covered by a
 * member. Members render above it (higher zIndex) and stay independently
 * movable / resizable.
 */
const PaintingGroupHullComponent = ({ data, selected }: NodeProps<PaintingGroupHullType>) => {
  return (
    <div
      className={cn(
        'h-full w-full rounded-lg border border-dashed transition',
        selected ? 'border-primary/70 bg-primary/[0.06]' : 'border-border-muted bg-muted/20'
      )}>
      {data.prompt && (
        <div className="pointer-events-none truncate px-3 pt-1.5 text-[11px] text-muted-foreground" title={data.prompt}>
          {data.prompt}
        </div>
      )}
    </div>
  )
}

/** Memoized: React Flow re-renders nodes on every viewport change. */
const PaintingGroupHull = memo(PaintingGroupHullComponent)
PaintingGroupHull.displayName = 'PaintingGroupHull'

export default PaintingGroupHull
