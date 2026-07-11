import type { PaintingData } from './types/paintingData'

/**
 * One feed entry: a single painting, or the N paintings of a multi-image
 * generation (sharing a `group_id`). Order follows first appearance in `items`.
 */
export interface PaintingEntry {
  /** Stable react key — a painting id, or `group:${groupId}`. */
  key: string
  paintings: PaintingData[]
}

/**
 * Collapse a flat painting list into feed entries: paintings sharing a
 * `group_id` fold into one entry (in first-seen position); ungrouped paintings
 * are their own entry. The canvas expresses the same grouping as a hull.
 */
export function groupPaintings(items: PaintingData[]): PaintingEntry[] {
  const entries: PaintingEntry[] = []
  const groupAt = new Map<string, number>()

  for (const painting of items) {
    if (painting.groupId) {
      const at = groupAt.get(painting.groupId)
      if (at != null) {
        entries[at].paintings.push(painting)
        continue
      }
      groupAt.set(painting.groupId, entries.length)
      entries.push({ key: `group:${painting.groupId}`, paintings: [painting] })
    } else {
      entries.push({ key: painting.id, paintings: [painting] })
    }
  }

  return entries
}
