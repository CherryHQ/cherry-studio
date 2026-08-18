/** One completed Knowledge row read as untrusted text from a detached database. */
export interface KnowledgeMaterialRow {
  readonly baseId: string
  readonly type: string
  readonly data: string
}

export interface KnowledgeIndexedMaterialRow extends KnowledgeMaterialRow {
  readonly id: string
}

export interface KnowledgeIndexRequirement {
  readonly itemId: string
  /** Path as stored in `index.sqlite.material.relative_path` (without `raw/`). */
  readonly relativePath: string
}

/**
 * Required, unit-relative source paths grouped by Knowledge base.
 *
 * `null` means one completed leaf cannot name rebuildable material, so the
 * resource unit cannot prove readiness. Directory rows are containers; their
 * leaf rows name the actual material.
 */
export type KnowledgeRequiredMaterialByBase = ReadonlyMap<string, readonly string[] | null>

interface KnowledgeMaterialPaths {
  /** The user-visible source retained for restore/read/download. */
  readonly source: string
  /** The artifact whose text the vector index actually describes. */
  readonly indexed: string
}

function materialPaths(row: Pick<KnowledgeMaterialRow, 'type' | 'data'>): KnowledgeMaterialPaths | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const data = parsed as { relativePath?: unknown; indexedRelativePath?: unknown }
  if (typeof data.relativePath !== 'string' || data.relativePath.length === 0) return null
  if (
    row.type === 'file' &&
    data.indexedRelativePath !== undefined &&
    (typeof data.indexedRelativePath !== 'string' || data.indexedRelativePath.length === 0)
  ) {
    return null
  }
  return {
    source: data.relativePath,
    indexed:
      row.type === 'file' && typeof data.indexedRelativePath === 'string' ? data.indexedRelativePath : data.relativePath
  }
}

/**
 * Project the exact item identity/path pairs a portable index must contain.
 *
 * Search results resolve `material.material_id` back to `knowledge_item.id`, so
 * path equality alone is not enough: an index with the right file under the
 * wrong material id would open successfully but every hit would be filtered as
 * invisible by the owner.
 */
export function collectKnowledgeIndexRequirements(
  rows: readonly KnowledgeIndexedMaterialRow[]
): ReadonlyMap<string, readonly KnowledgeIndexRequirement[] | null> {
  const byBase = new Map<string, KnowledgeIndexRequirement[] | null>()
  for (const row of rows) {
    if (row.type === 'directory') continue

    const collected = byBase.get(row.baseId)
    if (collected === null) continue

    const paths = materialPaths(row)
    if (paths === null) {
      byBase.set(row.baseId, null)
      continue
    }

    const requirements = collected ?? []
    requirements.push({ itemId: row.id, relativePath: paths.indexed })
    byBase.set(row.baseId, requirements)
  }
  return byBase
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

    const material = materialPaths(row)
    if (material === null) {
      byBase.set(row.baseId, null)
      continue
    }

    const paths = collected ?? []
    for (const relativePath of new Set([material.source, material.indexed])) {
      paths.push(`raw/${relativePath}`)
    }
    byBase.set(row.baseId, paths)
  }
  return byBase
}
