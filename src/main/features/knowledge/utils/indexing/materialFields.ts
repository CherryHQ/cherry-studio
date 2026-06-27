import { basename, extname } from 'node:path'

import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

/**
 * The subset of an indexable knowledge item needed to derive its index-store
 * material fields. The `Pick` is distributed per member so `type` and `data`
 * stay correlated (a single `Pick` over the union would collapse `data` to a bare
 * union and lose the file-only `relativePath` / `indexedRelativePath`). Shared by
 * the indexing job and the v1→v2 vector migrator so both stamp the material
 * identically (knowledge-technical-design.md §4.2).
 */
export type MaterialFieldSource =
  | Pick<KnowledgeItemOf<'file'>, 'id' | 'type' | 'data'>
  | Pick<KnowledgeItemOf<'url'>, 'id' | 'type' | 'data'>
  | Pick<KnowledgeItemOf<'note'>, 'id' | 'type' | 'data'>

/**
 * A material's stable relative path. A file uses its stored path (the processed
 * artifact when present). A url or note uses its captured snapshot path — a real
 * base file under `raw/`, materialized before the material is stamped (the index
 * job's ensure-snapshot step, or the vector migrator), so it is always present
 * here; a missing one is an invariant violation, not a fallback case.
 */
export function toMaterialRelativePath(item: MaterialFieldSource): string {
  if (item.type === 'file') {
    return item.data.indexedRelativePath ?? item.data.relativePath
  }
  if (!item.data.relativePath) {
    throw new Error(`Knowledge ${item.type} item ${item.id} has no captured snapshot relativePath for its material`)
  }
  return item.data.relativePath
}

/**
 * Extract a searchable title from a material's relative path. Strips the file
 * extension and returns the basename. Returns an empty string for empty input
 * (e.g. a material without a meaningful path).
 *
 * Used during indexing to populate the `title` search_text row so that file
 * names are discoverable by BM25 and vector search (issue #16396).
 */
export function extractTitleFromRelativePath(relativePath: string): string {
  const name = basename(relativePath)
  // Strip the extension (e.g. "report.pdf" → "report", "chapter 1.md" → "chapter 1")
  return extname(name) ? name.slice(0, -extname(name).length) : name
}
