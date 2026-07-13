import type { Edge } from '@xyflow/react'
import { useMemo } from 'react'

import type { PaintingData } from '../model/types/paintingData'

/**
 * Derive read-only lineage edges between painting cards on the canvas.
 *
 * The provenance is already implicit in the data: a derived painting (edit /
 * variation / reference / merge) carries its source card's **output** file as
 * one of its **input** files. So an edge `A → B` exists whenever one of B's
 * input file ids equals one of A's output file ids. No edge table, no extra
 * query — a pure function of the already-loaded history.
 *
 * Building a `Map<outputFileId, paintingId>` once (js-index-maps) keeps this
 * O(files) instead of O(paintings²). User-uploaded reference images that come
 * from no card simply don't resolve and produce no edge.
 */
export function buildPaintingLineageEdges(items: readonly PaintingData[]): Edge[] {
  const outputOwner = new Map<string, string>()
  for (const item of items) {
    for (const file of item.files) {
      // First writer wins: an output id belongs to the painting that produced it.
      if (!outputOwner.has(file.id)) outputOwner.set(file.id, item.id)
    }
  }

  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const item of items) {
    for (const input of item.inputFiles ?? []) {
      const source = outputOwner.get(input.id)
      if (!source || source === item.id) continue
      const id = `${source}->${item.id}`
      if (seen.has(id)) continue
      seen.add(id)
      edges.push({ id, source, target: item.id })
    }
  }
  return edges
}

export function usePaintingLineage(items: readonly PaintingData[]): Edge[] {
  return useMemo(() => buildPaintingLineageEdges(items), [items])
}
