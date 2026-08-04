import fs from 'node:fs/promises'

import { application } from '@application'
import Database from 'better-sqlite3'

import type {
  KnowledgeIndexSnapshotFailure,
  KnowledgeIndexSnapshotResult
} from './pipeline/vectorstore/KnowledgeVectorStoreService'
import { collectKnowledgeIndexRequirements, type KnowledgeIndexRequirement } from './portableProfilePolicy'

class PortableIndexValidationError extends Error {
  constructor(readonly reason: Extract<KnowledgeIndexSnapshotFailure, 'material-mismatch' | 'embedding-missing'>) {
    super(reason)
  }
}

function readDetachedRequirement(
  detachedDbPath: string,
  baseId: string
): { readonly materials: readonly KnowledgeIndexRequirement[] | null; readonly usesEmbeddings: boolean } | undefined {
  const db = new Database(detachedDbPath, { fileMustExist: true, readonly: true })
  try {
    const base = db
      .prepare('SELECT embedding_model_id AS embeddingModelId FROM knowledge_base WHERE id = ?')
      .get(baseId) as { embeddingModelId: string | null } | undefined
    if (!base) return undefined

    const rows = db
      .prepare(
        `SELECT id, base_id AS baseId, type, data
         FROM knowledge_item
         WHERE base_id = ? AND status = 'completed'`
      )
      .all(baseId) as Array<{ id: string; baseId: string; type: string; data: string }>
    const materialsByBase = collectKnowledgeIndexRequirements(rows)
    const required = materialsByBase.has(baseId) ? materialsByBase.get(baseId)! : []
    return {
      materials: required,
      usesEmbeddings: base.embeddingModelId !== null
    }
  } finally {
    db.close()
  }
}

function reconcileSnapshot(
  snapshotPath: string,
  requirement: { readonly materials: readonly KnowledgeIndexRequirement[]; readonly usesEmbeddings: boolean }
): void {
  const db = new Database(snapshotPath, { fileMustExist: true })
  try {
    db.pragma('foreign_keys = ON')
    const requiredById = new Map(requirement.materials.map((material) => [material.itemId, material.relativePath]))
    db.transaction(() => {
      const materialRows = db
        .prepare('SELECT material_id AS materialId, relative_path AS relativePath FROM material')
        .all() as Array<{
        materialId: string
        relativePath: string
      }>
      for (const row of materialRows) {
        if (requiredById.get(row.materialId) !== row.relativePath) {
          db.prepare('DELETE FROM material WHERE material_id = ?').run(row.materialId)
        }
      }

      db.prepare(
        `DELETE FROM search_text
         WHERE target_type = 'search_unit'
           AND NOT EXISTS (SELECT 1 FROM search_unit WHERE search_unit.unit_id = search_text.target_id)`
      ).run()
      db.prepare(
        `DELETE FROM embedding
         WHERE NOT EXISTS (
           SELECT 1 FROM search_text WHERE search_text.embedding_text_hash = embedding.embedding_text_hash
         )`
      ).run()
      db.prepare(
        `DELETE FROM content
         WHERE NOT EXISTS (SELECT 1 FROM material WHERE material.current_content_hash = content.content_hash)
           AND NOT EXISTS (SELECT 1 FROM search_unit WHERE search_unit.content_hash = content.content_hash)`
      ).run()

      const retained = db
        .prepare('SELECT material_id AS materialId, relative_path AS relativePath FROM material')
        .all() as Array<{
        materialId: string
        relativePath: string
      }>
      if (
        retained.length !== requiredById.size ||
        retained.some((row) => requiredById.get(row.materialId) !== row.relativePath)
      ) {
        throw new PortableIndexValidationError('material-mismatch')
      }
      for (const [materialId, relativePath] of requiredById) {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS unitCount
             FROM material
             JOIN search_unit USING (material_id)
             WHERE material.material_id = ? AND material.relative_path = ?`
          )
          .get(materialId, relativePath) as { unitCount: number }
        if (row.unitCount < 1) throw new PortableIndexValidationError('material-mismatch')
      }

      const bodyMissing = db
        .prepare(
          `SELECT 1
           FROM search_unit
           WHERE NOT EXISTS (
             SELECT 1 FROM search_text
             WHERE search_text.target_type = 'search_unit'
               AND search_text.target_id = search_unit.unit_id
               AND search_text.kind = 'body'
           )
           LIMIT 1`
        )
        .get()
      if (bodyMissing) throw new PortableIndexValidationError('material-mismatch')

      if (requirement.usesEmbeddings) {
        const embeddingMissing = db
          .prepare(
            `SELECT 1
             FROM search_text
             WHERE NOT EXISTS (
               SELECT 1 FROM embedding
               WHERE embedding.embedding_text_hash = search_text.embedding_text_hash
             )
             LIMIT 1`
          )
          .get()
        if (embeddingMissing) throw new PortableIndexValidationError('embedding-missing')
      }
    })()

    // Deleting orphan search_text rows fires the external-content FTS delete
    // trigger. The explicit integrity command proves that projection still
    // agrees with the retained table before the snapshot is accepted.
    db.prepare(`INSERT INTO search_text_fts(search_text_fts) VALUES ('integrity-check')`).run()
    const quickCheck = db.pragma('quick_check') as Array<Record<string, unknown>>
    if (quickCheck.length !== 1 || Object.values(quickCheck[0])[0] !== 'ok') {
      throw new PortableIndexValidationError('material-mismatch')
    }
  } finally {
    db.close()
  }
}

/**
 * Knowledge owner pipeline for a portable index:
 * online SQLite snapshot → detached-main-DB pruning → readiness proof.
 */
export async function capturePortableKnowledgeIndex(input: {
  readonly baseId: string
  readonly detachedDbPath: string
  readonly destination: string
  readonly signal?: AbortSignal
}): Promise<KnowledgeIndexSnapshotResult> {
  const requirement = readDetachedRequirement(input.detachedDbPath, input.baseId)
  if (!requirement || requirement.materials === null) {
    return { status: 'rebuild', reason: 'material-mismatch' }
  }

  const snapshot = await application
    .get('KnowledgeVectorStoreService')
    .snapshotPortableIndex(input.baseId, input.destination, input.signal)
  if (snapshot.status === 'rebuild') return snapshot

  try {
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('Knowledge index snapshot cancelled')
    reconcileSnapshot(snapshot.stagedPath, {
      materials: requirement.materials,
      usesEmbeddings: requirement.usesEmbeddings
    })
    return snapshot
  } catch (error) {
    await fs.rm(input.destination, { force: true }).catch(() => {})
    if (input.signal?.aborted || ['ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    return {
      status: 'rebuild',
      reason: error instanceof PortableIndexValidationError ? error.reason : 'material-mismatch'
    }
  }
}
