import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'

import { listDetachedBackgroundTasks, stopDetachedBackgroundTask, type BackgroundTaskRecord } from './backgroundTasks'
import { listBackgroundTaskRecords, saveBackgroundTaskRecord } from './backgroundTaskStore'

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
