import path from 'node:path'

/**
 * Knowledge-owned capture policy for portable profile snapshots.
 *
 * A base's source tree is authoritative. The open WAL vector index cannot be
 * copied as ordinary bytes, so generic capture excludes it and the Knowledge
 * owner materializes a verified online SQLite snapshot at the same path. Keep
 * this knowledge in the owner: generic filesystem capture code must not infer
 * Knowledge layout from filenames.
 */
const KNOWLEDGE_DERIVED_CAPTURE_PATHS = new Set([
  '.cherry/index.sqlite',
  '.cherry/index.sqlite-wal',
  '.cherry/index.sqlite-shm'
])

export function isKnowledgeCaptureExcluded(relativePath: string): boolean {
  return KNOWLEDGE_DERIVED_CAPTURE_PATHS.has(relativePath)
}

/** Resolve one direct managed Knowledge-base directory without exposing layout inference to Backup. */
export function knowledgeBaseIdFromManagedPath(knowledgeRoot: string, candidate: string): string | undefined {
  const root = path.resolve(knowledgeRoot)
  const resolved = path.resolve(candidate)
  if (path.dirname(resolved) !== root) return undefined
  const baseId = path.basename(resolved)
  return baseId && baseId !== '.' && baseId !== '..' ? baseId : undefined
}
