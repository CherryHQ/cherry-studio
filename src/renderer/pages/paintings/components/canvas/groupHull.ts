import { PAINTING_NODE_WIDTH } from './PaintingNode'

/** Padding between the hull border and its outermost member. */
export const HULL_PADDING = 16
const CLUSTER_GAP = 16
const CLUSTER_STEP = PAINTING_NODE_WIDTH + CLUSTER_GAP
/** Slack when testing whether a dragged member has left its group's cluster. */
const DETACH_MARGIN = 48

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Tight bounding box of the given rects. */
export function boundingBox(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Bounding box of the members, expanded by HULL_PADDING — the hull's frame. */
export function hullBounds(rects: Rect[]): Rect {
  const bb = boundingBox(rects)
  return {
    x: bb.x - HULL_PADDING,
    y: bb.y - HULL_PADDING,
    width: bb.width + HULL_PADDING * 2,
    height: bb.height + HULL_PADDING * 2
  }
}

/** Grid-cluster position of the index-th member (~√N columns) from an anchor. */
export function clusterPosition(
  anchor: { x: number; y: number },
  index: number,
  count: number
): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  return {
    x: anchor.x + (index % cols) * CLUSTER_STEP,
    y: anchor.y + Math.floor(index / cols) * CLUSTER_STEP
  }
}

/** Whether `rect` still overlaps `region` once `region` is grown by DETACH_MARGIN. */
export function withinGroup(rect: Rect, region: Rect): boolean {
  return (
    rect.x < region.x + region.width + DETACH_MARGIN &&
    rect.x + rect.width > region.x - DETACH_MARGIN &&
    rect.y < region.y + region.height + DETACH_MARGIN &&
    rect.y + rect.height > region.y - DETACH_MARGIN
  )
}
