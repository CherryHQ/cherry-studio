import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'

import {
  type CacheCleanupIssue,
  type CleanupStepResult,
  type CleanupTarget,
  collectOwnedTargets,
  inspectTarget,
  issue,
  measurePaths,
  removeCleanupTarget,
  resultFromSteps,
  toSizeSnapshot
} from './shared'

const logger = loggerService.withContext('CacheCleanup')

interface OrphanKnowledgeTarget extends CleanupTarget {
  baseId: string
}

async function collectOrphanKnowledgeTargets(): Promise<{
  targets: OrphanKnowledgeTarget[]
  issues: CacheCleanupIssue[]
}> {
  const item = 'orphan_knowledge_bases'
  if (hasPendingRestore()) {
    return { targets: [], issues: [issue(item, 'inspection_failed')] }
  }

  let inspection
  try {
    inspection = await application.get('KnowledgeService').inspectOrphanBaseArtifacts()
  } catch (error) {
    logger.warn('Failed to inspect orphan knowledge base artifacts', { error })
    return { targets: [], issues: [issue(item, 'inspection_failed')] }
  }

  const rootStatus = await inspectTarget(inspection.rootPath, item, 'directory')
  if (rootStatus === 'missing') {
    return { targets: [], issues: inspection.complete ? [] : [issue(item, 'inspection_failed')] }
  }
  if (rootStatus === 'invalid') {
    return { targets: [], issues: [issue(item, 'unsafe_target')] }
  }

  const candidates = inspection.artifacts.map(
    ({ baseId, path }): OrphanKnowledgeTarget => ({
      baseId,
      item: 'orphan_knowledge_bases:' + baseId,
      path,
      kind: 'directory'
    })
  )
  const owned = await collectOwnedTargets<OrphanKnowledgeTarget>(candidates)
  if (!inspection.complete) {
    owned.issues.push(issue(item, 'inspection_failed'))
  }
  return owned
}

function getCleanupPaths() {
  return {
    indexedDbRestore: application.getPath('app.userdata', 'IndexedDB.restore'),
    localStorageRestore: application.getPath('app.userdata', 'Local Storage.restore'),
    dataRestore: application.getPath('app.userdata', 'Data.restore')
  }
}

function collectRestoreTargets(): Promise<{ targets: CleanupTarget[]; issues: CacheCleanupIssue[] }> {
  const paths = getCleanupPaths()
  return collectOwnedTargets([
    { item: 'restore_indexeddb', path: paths.indexedDbRestore, kind: 'directory' },
    { item: 'restore_local_storage', path: paths.localStorageRestore, kind: 'directory' },
    { item: 'restore_data', path: paths.dataRestore, kind: 'directory' }
  ])
}

export async function inspectOrphanedData(): Promise<CacheCleanupSizeSnapshot> {
  const [fileReport, knowledgePlan, restorePlan] = await Promise.all([
    application.get('FileManager').inspectOrphanFiles(),
    collectOrphanKnowledgeTargets(),
    collectRestoreTargets()
  ])
  const targetMeasurement = await measurePaths(
    [...knowledgePlan.targets, ...restorePlan.targets].map(({ item, path: targetPath }) => ({
      item,
      path: targetPath
    }))
  )
  const fileIssues: CacheCleanupIssue[] = []
  if (fileReport.outcome !== 'completed' || fileReport.statFailedCount > 0) {
    fileIssues.push(issue('orphan_files', 'inspection_failed'))
  }
  const reclaimableFileBytes = fileReport.outcome === 'completed' ? fileReport.plannedDeleteBytes : 0

  return toSizeSnapshot(
    {
      bytes: reclaimableFileBytes + targetMeasurement.bytes,
      issues: [...fileIssues, ...knowledgePlan.issues, ...restorePlan.issues, ...targetMeasurement.issues]
    },
    'exact'
  )
}

async function removeOrphanKnowledgeTarget(target: OrphanKnowledgeTarget): Promise<CleanupStepResult> {
  if (hasPendingRestore()) return { state: 'skipped' }

  const { baseId } = target
  const status = await inspectTarget(target.path, target.item, target.kind)
  if (status === 'missing') return { state: 'not_found' }
  if (status === 'invalid') return { state: 'skipped' }

  try {
    const removed = await application.get('KnowledgeService').removeOrphanBaseArtifacts(baseId)
    if (!removed) {
      logger.info('Skipped knowledge base directory that is no longer orphaned', { baseId, path: target.path })
      return { state: 'not_found' }
    }
    logger.info('Removed orphan knowledge base artifacts', { baseId, path: target.path })
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Failed to remove orphan knowledge base artifacts', { baseId, path: target.path, error })
    return { state: 'failed' }
  }
}

export async function clearOrphanedData(): Promise<CacheCleanupGroupResult> {
  const [fileReport, knowledgePlan, restorePlan] = await Promise.all([
    application.get('FileManager').cleanupOrphanFiles(),
    collectOrphanKnowledgeTargets(),
    collectRestoreTargets()
  ])
  const steps = await Promise.all([
    ...knowledgePlan.targets.map(removeOrphanKnowledgeTarget),
    ...restorePlan.targets.map(removeCleanupTarget)
  ])

  if (fileReport.outcome === 'completed') {
    if (fileReport.actualDeleteCount > 0) steps.push({ state: 'cleared' })
    if (fileReport.statFailedCount > 0) steps.push({ state: 'failed' })
    else if (fileReport.actualDeleteCount === 0) steps.push({ state: 'not_found' })
  } else if (fileReport.outcome === 'partial') {
    if (fileReport.actualDeleteCount > 0) steps.push({ state: 'cleared' })
    steps.push({ state: 'failed' })
  } else if (fileReport.outcome === 'aborted') {
    steps.push({ state: 'skipped' })
  } else {
    steps.push({ state: 'failed' })
  }
  steps.push(...[...knowledgePlan.issues, ...restorePlan.issues].map(() => ({ state: 'skipped' as const })))
  return resultFromSteps('orphaned_data', steps)
}
