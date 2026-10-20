import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { KnowledgeBaseIdSchema } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('Knowledge:BaseArtifacts')
const ORPHAN_FRESHNESS_GATE_MS = 5 * 60 * 1000

export interface OrphanBaseArtifact {
  baseId: string
  path: string
}

export interface OrphanBaseArtifactsInspection {
  rootPath: string
  artifacts: OrphanBaseArtifact[]
  complete: boolean
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

/** Find UUID-named knowledge directories that no longer have an owning database row. */
export async function inspectOrphanBaseArtifacts(): Promise<OrphanBaseArtifactsInspection> {
  const knowledgeRoot = application.getPath('feature.knowledgebase.data')
  try {
    const rootStats = await fs.lstat(knowledgeRoot)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      logger.warn('Knowledge base root has an unexpected type', { path: knowledgeRoot })
      return { rootPath: knowledgeRoot, artifacts: [], complete: false }
    }
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return { rootPath: knowledgeRoot, artifacts: [], complete: true }
    logger.warn('Failed to inspect knowledge base root', { path: knowledgeRoot, error })
    return { rootPath: knowledgeRoot, artifacts: [], complete: false }
  }

  let knownBaseIds: Set<string>
  let entries: Dirent[]
  try {
    knownBaseIds = knowledgeBaseService.listAllIds()
    entries = await fs.readdir(knowledgeRoot, { withFileTypes: true })
  } catch (error) {
    logger.warn('Failed to inspect knowledge base ownership', { path: knowledgeRoot, error })
    return { rootPath: knowledgeRoot, artifacts: [], complete: false }
  }

  const artifacts: OrphanBaseArtifact[] = []
  let complete = true
  for (const entry of entries) {
    if (!KnowledgeBaseIdSchema.safeParse(entry.name).success || knownBaseIds.has(entry.name)) continue

    const artifactPath = path.join(knowledgeRoot, entry.name)
    if (entry.isSymbolicLink()) {
      logger.warn('Skipped symbolic-link knowledge base artifact', { baseId: entry.name, path: artifactPath })
      complete = false
      continue
    }
    if (!entry.isDirectory()) continue

    try {
      const stats = await fs.lstat(artifactPath)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        logger.warn('Knowledge base artifact changed type during inspection', {
          baseId: entry.name,
          path: artifactPath
        })
        complete = false
        continue
      }
      if (Date.now() - stats.mtimeMs <= ORPHAN_FRESHNESS_GATE_MS) continue
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) continue
      logger.warn('Failed to inspect knowledge base artifact age', { baseId: entry.name, path: artifactPath, error })
      complete = false
      continue
    }

    artifacts.push({ baseId: entry.name, path: artifactPath })
  }

  return { rootPath: knowledgeRoot, artifacts, complete }
}
