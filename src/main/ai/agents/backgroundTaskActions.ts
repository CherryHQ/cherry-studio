import path from 'node:path'

import { application } from '@application'
import { agentBackgroundTaskService } from '@data/services/AgentBackgroundTaskService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'

import {
  listDetachedBackgroundTasks,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask,
  type BackgroundTaskRecord,
  type CompletedBackgroundTask,
  type StartDetachedBackgroundTaskInput
} from './backgroundTasks'

const logger = loggerService.withContext('backgroundTaskActions')

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
  // SQLite is the panel's index over these records, not a second source of truth. Reading it back
  // after a failed write would hand the panel a different answer from the agent's own list tool,
  // which returns the reconciled disk records, so the disk stays the answer either way.
  try {
    agentBackgroundTaskService.saveRecords(agentId, records)
  } catch (error) {
    logger.error('Failed to index background tasks after reconcile', { agentId, error })
    return records
  }
  return agentBackgroundTaskService.listByAgent(agentId)
}

/** Announces a finished task on every channel that watches this agent, wherever it was stopped from. */
export function notifyAgentBackgroundTaskCompletion(agentId: string, task: CompletedBackgroundTask): void {
  try {
    const adapters = application.get('ChannelManager').getAgentAdapters(agentId)
    for (const adapter of adapters) {
      for (const chatId of adapter.notifyChatIds) {
        adapter.sendMessage(chatId, task.summary).catch((err: unknown) => {
          logger.warn('Failed to deliver background task completion notification', {
            agentId,
            taskId: task.record.id,
            channelId: adapter.channelId,
            chatId,
            error: err
          })
        })
      }
    }
  } catch (err) {
    logger.warn('Error while building background task completion notification', {
      agentId,
      taskId: task.record.id,
      error: err
    })
  }
}

export async function stopAgentBackgroundTask(
  agentId: string,
  taskId: string,
  force: boolean
): Promise<BackgroundTaskRecord | undefined> {
  if (!agentService.getAgent(agentId)) throw new Error(`Agent ${agentId} not found`)
  const record = await stopDetachedBackgroundTask(storageDirFor(agentId), taskId, force, (task) => {
    notifyAgentBackgroundTaskCompletion(agentId, task)
  })
  if (record) {
    try {
      agentBackgroundTaskService.saveRecord(agentId, record)
    } catch (error) {
      logger.error('Failed to index background task after stop', { agentId, taskId, error })
    }
  }
  return record
}

/**
 * Force-stops every running detached task of an agent. Permanent deletion calls
 * this before the agent's records are swept: afterwards no Cherry control path
 * can reach the process. Archival keeps tasks running so restore stays lossless.
 *
 * Each stop shells out synchronously to the platform, so the stops run together
 * rather than one per task: an agent may hold any number of them. Every task is
 * still stopped before this resolves, and any task that survives throws, so a
 * partial sweep cannot be mistaken for a clean one.
 */
export async function stopAllAgentBackgroundTasks(agentId: string): Promise<void> {
  const storageDir = storageDirFor(agentId)
  const running = (await listDetachedBackgroundTasks(storageDir)).filter((record) => record.status === 'running')
  const stopped = await Promise.all(running.map((record) => stopDetachedBackgroundTask(storageDir, record.id, true)))
  for (const [index, record] of running.entries()) {
    if (!stopped[index] || stopped[index].status === 'running') {
      throw new Error(`Cannot permanently delete Agent ${agentId} while background task ${record.id} is running`)
    }
  }
}
