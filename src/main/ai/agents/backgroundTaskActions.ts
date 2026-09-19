import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'

import {
  listDetachedBackgroundTasks,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask,
  type BackgroundTaskRecord,
  type StartDetachedBackgroundTaskInput
} from './backgroundTasks'
import { listBackgroundTaskRecords, saveBackgroundTaskRecord } from './backgroundTaskStore'

function storageDirFor(agentId: string): string {
  return path.join(application.getPath('feature.agents.data'), agentId, 'background-tasks')
}

/** Serializes detached-task starts for one agent against its permanent purge. */
const agentTaskMutexes = new Map<string, Promise<unknown>>()

async function withAgentTaskMutex<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
  const previous = agentTaskMutexes.get(agentId)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  agentTaskMutexes.set(agentId, current)
  if (previous) await previous
  try {
    return await operation()
  } finally {
    release()
    if (agentTaskMutexes.get(agentId) === current) agentTaskMutexes.delete(agentId)
  }
}

export type StartAgentBackgroundTaskInput = StartDetachedBackgroundTaskInput & { agentId: string }

export async function startAgentBackgroundTask(input: StartAgentBackgroundTaskInput): Promise<BackgroundTaskRecord> {
  return withAgentTaskMutex(input.agentId, async () => {
    // Re-checked under the mutex: the agent may have been purged while this start waited.
    if (!agentService.getAgent(input.agentId)) throw new Error(`Agent ${input.agentId} not found`)
    return startDetachedBackgroundTask(input)
  })
}

/**
 * Runs a permanent deletion under the same per-agent mutex as task starts, so a start queued
 * behind this purge cannot spawn a task after the agent's control path is gone.
 */
export async function purgeAgentBackgroundTasks<T>(agentId: string, runDeletion: () => Promise<T>): Promise<T> {
  return withAgentTaskMutex(agentId, async () => {
    await stopAllAgentBackgroundTasks(agentId)
    return runDeletion()
  })
}

export async function listAgentBackgroundTasks(agentId: string): Promise<BackgroundTaskRecord[]> {
  if (!agentService.getAgent(agentId)) throw new Error(`Agent ${agentId} not found`)
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
  if (!agentService.getAgent(agentId)) throw new Error(`Agent ${agentId} not found`)
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
    const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true)
    if (!stopped || stopped.status === 'running') {
      throw new Error(`Cannot permanently delete Agent ${agentId} while background task ${record.id} is running`)
    }
  }
}
