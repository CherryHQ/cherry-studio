/** One completed Knowledge row read as untrusted text from a detached database. */
export interface KnowledgeMaterialRow {
  readonly baseId: string
  readonly type: string
  readonly data: string
}

/**
 * Required, unit-relative source paths grouped by Knowledge base.
 *
 * `null` means one completed leaf cannot name rebuildable material, so the
 * resource unit cannot prove readiness. Directory rows are containers; their
 * leaf rows name the actual material.
 */
export type KnowledgeRequiredMaterialByBase = ReadonlyMap<string, readonly string[] | null>

function materialRelativePath(row: Pick<KnowledgeMaterialRow, 'type' | 'data'>): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const data = parsed as { relativePath?: unknown; indexedRelativePath?: unknown }
  const chosen =
    row.type === 'file' && typeof data.indexedRelativePath === 'string' ? data.indexedRelativePath : data.relativePath
  return typeof chosen === 'string' && chosen.length > 0 ? chosen : null
}

/**
 * Project the Knowledge owner's canonical `raw/` material closure without
 * importing Backup types or touching the filesystem.
 */
export function collectKnowledgeRequiredMaterial(
  rows: readonly KnowledgeMaterialRow[]
): KnowledgeRequiredMaterialByBase {
  const byBase = new Map<string, string[] | null>()
  for (const row of rows) {
    if (row.type === 'directory') continue

    const collected = byBase.get(row.baseId)
    if (collected === null) continue

    const relativePath = materialRelativePath(row)
    if (relativePath === null) {
      byBase.set(row.baseId, null)
      continue
    }

    const paths = collected ?? []
    paths.push(`raw/${relativePath}`)
    byBase.set(row.baseId, paths)
  }
  return byBase
}
