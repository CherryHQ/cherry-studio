/**
 * Knowledge-owned capture policy for portable profile snapshots.
 *
 * A base's source tree is authoritative except for the rebuildable vector index
 * at the unit root. Keep this knowledge in the owner: generic filesystem
 * capture code must not infer Knowledge layout from filenames.
 */
const KNOWLEDGE_DERIVED_CAPTURE_PATHS = new Set([
  '.cherry/index.sqlite',
  '.cherry/index.sqlite-wal',
  '.cherry/index.sqlite-shm'
])

export function isKnowledgeCaptureExcluded(relativePath: string): boolean {
  return KNOWLEDGE_DERIVED_CAPTURE_PATHS.has(relativePath)
}
