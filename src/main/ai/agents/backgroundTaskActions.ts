import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'

import { listDetachedBackgroundTasks, stopDetachedBackgroundTask, type BackgroundTaskRecord } from './backgroundTasks'
import { listBackgroundTaskRecords, saveBackgroundTaskRecord } from './backgroundTaskStore'

const logger = loggerService.withContext('backgroundTaskActions')

function storageDirFor(agentId: string): string {
  if (!agentService.getAgent(agentId)) throw new Error(`Agent ${agentId} not found`)
  return path.join(application.getPath('feature.agents.data'), agentId, 'background-tasks')
}

export async function listAgentBackgroundTasks(agentId: string): Promise<BackgroundTaskRecord[]> {
  const records = await listDetachedBackgroundTasks(storageDirFor(agentId))
  // Reconcile tasks completed while Cherry was closed and backfill pre-migration JSON records.
  for (const record of records) saveBackgroundTaskRecord(agentId, record)
  return listBackgroundTaskRecords(agentId)
}

export async function stopAgentBackgroundTask(
  agentId: string,
  taskId: string,
  force: boolean
): Promise<BackgroundTaskRecord | undefined> {
  const record = await stopDetachedBackgroundTask(storageDirFor(agentId), taskId, force)
  if (record) saveBackgroundTaskRecord(agentId, record)
  return record
}

/**
 * Force-stops every running detached task of an agent. Permanent deletion calls
 * this before the agent's records are swept: afterwards no Cherry control path
 * can reach the process. Archival keeps tasks running so restore stays lossless.
 */
export async function stopAllAgentBackgroundTasks(agentId: string): Promise<void> {
  const storageDir = storageDirFor(agentId)
  for (const record of await listDetachedBackgroundTasks(storageDir)) {
    if (record.status !== 'running') continue
    try {
      await stopDetachedBackgroundTask(storageDir, record.id, true)
    } catch (error) {
      logger.warn('Failed to stop detached background task during Agent purge', { agentId, taskId: record.id, error })
    }
  }
}
