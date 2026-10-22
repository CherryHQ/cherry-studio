import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentBackgroundTaskService } from '@data/services/AgentBackgroundTaskService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { sanitizeChannelOutput } from '@main/ai/channels'
import { isSameOrInside } from '@main/utils/file'

import {
  getDetachedBackgroundTask,
  hasLiveTaskEvidence,
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

/** While closed, no task may start: Data Reset is stopping everything before it erases Data. */
let backgroundTaskAdmissionClosed = false

/** Raised when staging a Data Reset met a task it could not stop and verify. */
export class DetachedTasksBusyError extends Error {}

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

/**
 * Waits out every start already admitted. Such a start may still be opening its log — it has no
 * record for an inventory to find yet — so listing tasks before it finishes would let it spawn
 * after the reset's sweep and outlive the control path the commit erases.
 */
async function drainAdmittedStarts(): Promise<void> {
  // Admission is closed, so only operations admitted earlier are registered; the loop covers a
  // purge that queued behind one of them.
  while (agentTaskMutexes.size > 0) {
    // A start that failed spawned nothing, so its rejection must not cut the wait short for the rest.
    await Promise.allSettled([...agentTaskMutexes.values()])
  }
}

export type StartAgentBackgroundTaskInput = StartDetachedBackgroundTaskInput & { agentId: string }

export async function startAgentBackgroundTask(input: StartAgentBackgroundTaskInput): Promise<BackgroundTaskRecord> {
  if (backgroundTaskAdmissionClosed) {
    throw new Error('Cannot start a background task while a data reset is stopping them')
  }
  return withAgentTaskMutex(input.agentId, async () => {
    // Re-checked under the mutex: the agent may have been purged, or a reset may have closed
    // admission, while this start waited.
    if (backgroundTaskAdmissionClosed) {
      throw new Error('Cannot start a background task while a data reset is stopping them')
    }
    if (!agentService.getAgent(input.agentId)) throw new Error(`Agent ${input.agentId} not found`)
    return startDetachedBackgroundTask(input)
  })
}

/**
 * Stops every detached task this app can still reach and verifies each one. Data Reset erases the
 * records, logs and workspaces those tasks live in, so a survivor would keep working with nothing
 * left that could list, stop, or purge it.
 */
export async function stopAllDetachedBackgroundTasks(): Promise<void> {
  await Promise.all((await listAgentIds()).map((agentId) => stopAllAgentBackgroundTasks(agentId)))
}

/**
 * Closes admission and stops every detached task before running `commit`, which is where a Data
 * Reset stages its marker and shuts down. A task that cannot be stopped and verified raises
 * {@link DetachedTasksBusyError} so staging is refused instead of erasing its control path.
 */
export async function withDetachedTasksStopped<T>(commit: () => Promise<T>): Promise<T> {
  if (backgroundTaskAdmissionClosed) throw new DetachedTasksBusyError('Background tasks are already being stopped')
  backgroundTaskAdmissionClosed = true
  try {
    // Before inventorying: a start admitted just before admission closed may still be awaiting its
    // log, so its record does not exist yet and the sweep would find nothing to stop.
    await drainAdmittedStarts()
    try {
      await stopAllDetachedBackgroundTasks()
    } catch (error) {
      throw new DetachedTasksBusyError('A detached background task could not be stopped and verified', {
        cause: error
      })
    }
    return await commit()
  } finally {
    backgroundTaskAdmissionClosed = false
  }
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

/**
 * Every detached task this app can still reach that has not reached a terminal state, across all
 * agents. Read-only — unlike {@link stopAllAgentBackgroundTasks}, it does not stop anything.
 */
async function listAgentIds(): Promise<string[]> {
  try {
    return (await readdir(application.getPath('feature.agents.data'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`Failed to inventory detached background tasks: ${String(error)}`, { cause: error })
  }
}

async function listLiveTaskRecords(): Promise<Array<{ agentId: string; record: BackgroundTaskRecord }>> {
  // Only a confirmed absence counts as empty. Restore treats the result as "no live detached task",
  // so an inventory read that fails for any reason must reach its caller as a failure instead of
  // being flattened into the same empty list a genuinely task-free install produces.
  const agentIds = await listAgentIds()

  const perAgent = await Promise.all(
    agentIds.map(async (agentId) => {
      const storageDir = storageDirFor(agentId)
      const records = await listDetachedBackgroundTasks(storageDir)
      const live: BackgroundTaskRecord[] = []
      for (const record of records) {
        // A record reconciles to `unknown` for two very different reasons: real work this app can
        // no longer attribute, and an exit that happened while it was closed. Only the first may
        // block — the second has no process left to strand, and holding it here would refuse every
        // restore until the record is deleted by hand, since Stop rejects `unknown` and the panel
        // hides its controls.
        if (
          record.status === 'running' ||
          (record.status === 'unknown' && (await hasLiveTaskEvidence(storageDir, record)))
        ) {
          live.push(record)
        }
      }
      return live.map((record) => ({ agentId, record }))
    })
  )
  return perAgent.flat()
}

/**
 * Every live detached task, across all agents. Restore replaces the whole `Data/Agents` tree
 * wholesale, so a task listed here is one whose record and index row promotion would delete while
 * its process keeps running: nothing could list, stop, or purge it afterwards.
 */
export async function listLiveDetachedBackgroundTasks(): Promise<Array<{ agentId: string; id: string; pid: number }>> {
  return (await listLiveTaskRecords()).map(({ agentId, record }) => ({ agentId, id: record.id, pid: record.pid }))
}

/**
 * Whether a live detached task still works inside `workspacePath`. Such a task outlives its
 * session, so archiving that session may not rename or remove the directory it runs in.
 */
export async function workspaceHasLiveDetachedTasks(workspacePath: string): Promise<boolean> {
  return (await listLiveTaskRecords()).some(
    ({ record }) => typeof record.cwd === 'string' && isSameOrInside(record.cwd, workspacePath)
  )
}

export async function listAgentBackgroundTasks(agentId: string): Promise<BackgroundTaskRecord[]> {
  if (!agentService.getAgent(agentId)) throw new Error(`Agent ${agentId} not found`)
  const records = await listDetachedBackgroundTasks(storageDirFor(agentId))
  // SQLite is the panel's index over these records, not a second source of truth. Reading it back
  // would hand the panel a different answer from the agent's own list tool, which returns the
  // reconciled disk records — and inside a backup's pauseWrites hold the index is stale by
  // design, so the disk stays the answer either way.
  try {
    agentBackgroundTaskService.saveRecords(agentId, records)
  } catch (error) {
    logger.error('Failed to index background tasks after reconcile', { agentId, error })
  }
  return records
}

/**
 * Announces a finished task to the recipients the starting turn authorized, wherever the task was
 * stopped from. The summary carries task name, id, outcome, and the log path, so delivery stays
 * inside the record's persisted recipient scope — the same authority `notify` enforces live. The
 * name is unrestricted input, so the summary is redacted here exactly as a `notify` reply would
 * be; the channel adapters send what they are given.
 */
export function notifyAgentBackgroundTaskCompletion(agentId: string, task: CompletedBackgroundTask): void {
  try {
    const authorized = new Set(task.record.notifyChannelIds ?? [])
    const adapters = application.get('ChannelManager').getAgentAdapters(agentId)
    for (const adapter of adapters.filter((adapter) => authorized.has(adapter.channelId))) {
      for (const chatId of adapter.notifyChatIds) {
        adapter.sendMessage(chatId, sanitizeChannelOutput(task.summary).text).catch((err: unknown) => {
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
  const records = await listDetachedBackgroundTasks(storageDir)
  const running = records.filter((record) => record.status === 'running')
  const stopped = await Promise.all(running.map((record) => stopDetachedBackgroundTask(storageDir, record.id, true)))
  for (const [index, record] of running.entries()) {
    if (stopped[index] && stopped[index].status !== 'running') continue
    // An empty stop result can also mean the task finished between listing and stopping, because
    // the stop itself re-reconciles the record. Re-read before rejecting: a task now verified
    // terminal is safe to delete; one still running or unverifiable still refuses the purge.
    const settled = await getDetachedBackgroundTask(storageDir, record.id)
    if (settled && settled.status !== 'running') continue
    throw new Error(`Cannot permanently delete Agent ${agentId} while background task ${record.id} is running`)
  }
  // An unresolved record must survive the purge: live work may answer to it — in its old group, or
  // through the marker after a setsid() escape — and deleting the record would strip the last
  // control path it has. The pre-stop snapshot cannot tell this: a force-stop itself can move a
  // task there, when its SIGKILL removes the supervisor the restart had verified while a privileged
  // worker survives the group signal, so the records are re-read as the stops left them. The group
  // alone is not enough: a supervisor killed from outside leaves its marked worker in no group at
  // all, and the full evidence is what still names it.
  for (const record of await listDetachedBackgroundTasks(storageDir)) {
    if (record.status === 'unknown' && (await hasLiveTaskEvidence(storageDir, record))) {
      throw new Error(`Cannot permanently delete Agent ${agentId} while background task ${record.id} is unresolved`)
    }
  }
}
