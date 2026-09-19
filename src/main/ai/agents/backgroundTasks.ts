/**
 * Detached background tasks for agent sessions.
 *
 * Unlike the runtime-native background shells (e.g. Claude Code's
 * `run_in_background`), whose processes live inside the CLI child-process tree
 * and die with the CLI session, tasks started here are spawned into their own
 * session (Node `detached: true`; libuv calls `setsid()` on POSIX) and keep
 * running across session turns, CLI exits, and app restarts.
 *
 * Every task gets a JSON record, a merged log file, and — once it exits while
 * the app is alive — a `<id>.done` sentinel. The database indexes reconciled
 * records for the GUI; files preserve process exit evidence across restarts.
 */

import { execFileSync, spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

export type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

const logger = loggerService.withContext('AgentBackgroundTasks')
const activeTaskPids = new Map<string, number>()
const recordLocks = new Map<string, Promise<void>>()

async function withRecordLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
  const previous = recordLocks.get(taskId)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  recordLocks.set(taskId, current)
  if (previous) await previous
  try {
    return await operation()
  } finally {
    release()
    if (recordLocks.get(taskId) === current) recordLocks.delete(taskId)
  }
}

export const BACKGROUND_TASK_RECORD_EXT = '.json'
export const BACKGROUND_TASK_LOG_EXT = '.log'
export const BACKGROUND_TASK_SENTINEL_EXT = '.done'

export const MAX_BACKGROUND_TASK_COMMAND_LENGTH = 10_000

/** Payload handed to the completion callback and written into the sentinel file. */
export interface BackgroundTaskCompletion {
  id: string
  status: Exclude<BackgroundTaskStatus, 'running' | 'unknown'>
  exitCode: number | null
  signal: string | null
  finishedAt: string
  durationMs: number
  logFile: string
}

export interface CompletedBackgroundTask {
  record: BackgroundTaskRecord
  summary: string
}

export interface StartDetachedBackgroundTaskInput {
  /** Directory holding the `<id>.json` / `<id>.log` / `<id>.done` files. */
  storageDir: string
  command: string
  /** Working directory for the task; callers use the session workspace. */
  cwd: string
  name?: string
  /** Invoked once when the task exits while this app process is still alive. */
  onExit?: (task: CompletedBackgroundTask) => void
}

/** Pure spawn-option factory so the detach contract is assertable without spawning. */
export function buildDetachedBackgroundTaskSpawnOptions(cwd: string, stdoutFd: number, stderrFd: number): SpawnOptions {
  return {
    cwd,
    // libuv makes the child a session leader (setsid) on POSIX and gives it a
    // new process group on Windows, so it outlives this app and the CLI.
    detached: true,
    shell: true,
    windowsHide: true,
    // Windows cmd owns its file redirection (see startDetachedBackgroundTask); inherited numeric
    // file descriptors can silently lose detached child output there. POSIX shares the log fd.
    stdio: process.platform === 'win32' ? ['ignore', 'ignore', 'ignore'] : ['ignore', stdoutFd, stderrFd]
  }
}

/** `kill(pid, 0)` liveness probe; EPERM means the pid exists but is not ours. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function startDetachedBackgroundTask(
  input: StartDetachedBackgroundTaskInput
): Promise<BackgroundTaskRecord> {
  const command = input.command
  if (!command.trim()) throw new Error('Background task command must not be empty')
  if (command.length > MAX_BACKGROUND_TASK_COMMAND_LENGTH) {
    throw new Error(`Background task command exceeds ${MAX_BACKGROUND_TASK_COMMAND_LENGTH} characters`)
  }

  await mkdir(input.storageDir, { recursive: true })
  const id = `bt-${Date.now()}-${randomUUID().slice(0, 8)}`
  const logFile = path.join(input.storageDir, `${id}${BACKGROUND_TASK_LOG_EXT}`)
  const startedAt = new Date().toISOString()

  const logHandle = await open(logFile, 'a', 0o600)
  if (process.platform === 'win32') await logHandle.close()
  try {
    // cmd.exe reopens the log itself, so the detached process keeps a valid output handle even
    // after Cherry Studio exits. Windows paths cannot contain a double quote.
    const spawnCommand = process.platform === 'win32' ? `${command} 1>>"${logFile}" 2>>&1` : command
    const child = spawn(spawnCommand, buildDetachedBackgroundTaskSpawnOptions(input.cwd, logHandle.fd, logHandle.fd))
    child.unref()

    const record: BackgroundTaskRecord = {
      id,
      name: input.name?.trim() || 'background task',
      command,
      pid: child.pid ?? -1,
      pidStartTime: child.pid ? getPidStartTime(child.pid) : undefined,
      cwd: input.cwd,
      startedAt,
      logFile,
      status: 'running',
      exitCode: null,
      signal: null
    }
    if (record.pid > 0) activeTaskPids.set(id, record.pid)

    // A spawn failure can emit both 'error' and 'close'; finalize guards so
    // at most one completion lands. Handlers go
    // on before any await — both events can fire on the first ticks.
    let settled = false
    const finalize = (status: BackgroundTaskCompletion['status'], exitCode: number | null, signal: string | null) => {
      if (settled) return
      settled = true
      activeTaskPids.delete(id)
      void finalizeDetachedBackgroundTask(input.storageDir, record, input.onExit, status, exitCode, signal)
    }
    child.on('error', (error) => {
      logger.warn('Detached background task failed to spawn', { taskId: id, error })
      finalize('failed', null, null)
    })
    // Wait for stdio to close before publishing completion: on Windows, `exit` can fire
    // before the detached process's final log bytes become readable.
    child.on('close', (code, signal) => finalize(code === 0 ? 'completed' : 'failed', code, signal))

    // Synchronously, so an immediately-exiting task cannot finalize before the
    // running record exists on disk.
    try {
      writeRecordSync(input.storageDir, record)
    } catch (error) {
      settled = true
      activeTaskPids.delete(id)
      try {
        if (record.pid > 0) {
          if (process.platform === 'win32') {
            execFileSync('taskkill', ['/PID', String(record.pid), '/T', '/F'], { timeout: 5_000 })
          } else {
            process.kill(-record.pid, 'SIGKILL')
          }
        }
      } catch (stopError) {
        logger.error('Could not stop unrecorded detached task', { taskId: id, stopError })
      }
      throw error
    }

    logger.info('Detached background task started', { taskId: id, pid: record.pid })
    return record
  } finally {
    // POSIX child holds its own dup of this fd; Windows closed it before cmd reopened the log.
    if (process.platform !== 'win32') await logHandle.close()
  }
}

export async function getDetachedBackgroundTask(
  storageDir: string,
  taskId: string
): Promise<BackgroundTaskRecord | undefined> {
  if (!taskId || taskId.includes('/') || taskId.includes('\\') || taskId.includes('..')) return undefined
  const record = await readRecord(storageDir, `${taskId}${BACKGROUND_TASK_RECORD_EXT}`)
  return record ? reconcileDetachedBackgroundTask(storageDir, record) : undefined
}

/** Signal only the process group created for this task; never the app or its CLI. */
export async function stopDetachedBackgroundTask(
  storageDir: string,
  taskId: string,
  force = false
): Promise<BackgroundTaskRecord | undefined> {
  return withRecordLock(taskId, () => stopDetachedBackgroundTaskUnlocked(storageDir, taskId, force))
}

async function stopDetachedBackgroundTaskUnlocked(
  storageDir: string,
  taskId: string,
  force: boolean
): Promise<BackgroundTaskRecord | undefined> {
  const record = await getDetachedBackgroundTask(storageDir, taskId)
  if (!record || record.status !== 'running' || record.pid <= 0) return undefined
  // A recycled PID could belong to another application. Old records without a start stamp cannot
  // be signalled safely after restart; newly created tasks always capture one on POSIX.
  const liveChild = activeTaskPids.get(record.id) === record.pid
  if (process.platform === 'win32' && !liveChild) return undefined
  if (
    process.platform !== 'win32' &&
    !liveChild &&
    (!record.pidStartTime || getPidStartTime(record.pid) !== record.pidStartTime)
  ) {
    return undefined
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM'
  const requested = {
    ...record,
    stopRequestedAt: new Date().toISOString(),
    stopSignal: signal,
    note: force ? 'Kill requested.' : 'Stop requested; use Kill if the process does not exit.'
  }
  await writeRecord(storageDir, requested)
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(record.pid), '/T', ...(force ? ['/F'] : [])], { timeout: 5_000 })
    } else {
      process.kill(-record.pid, signal)
    }
  } catch (error) {
    await writeRecord(storageDir, record)
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined
    throw error
  }
  if (!force) return (await getDetachedBackgroundTask(storageDir, taskId)) ?? requested
  const completion: BackgroundTaskCompletion = {
    id: record.id,
    status: 'stopped',
    exitCode: null,
    signal,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(record.startedAt),
    logFile: record.logFile
  }
  const stopped = { ...requested, ...completion, note: undefined }
  await writeRecord(storageDir, stopped)
  await writeFile(
    path.join(storageDir, `${record.id}${BACKGROUND_TASK_SENTINEL_EXT}`),
    JSON.stringify(completion, null, 2),
    {
      mode: 0o600
    }
  )
  return (await getDetachedBackgroundTask(storageDir, taskId)) ?? stopped
}

function getPidStartTime(pid: number): string | undefined {
  if (process.platform === 'win32') return undefined
  try {
    return (
      execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1_000 }).trim() || undefined
    )
  } catch {
    return undefined
  }
}

/**
 * List every task record, newest first. Records still marked `running` are
 * reconciled read-only: an existing sentinel wins, then a pid liveness probe,
 * and a dead pid with no sentinel becomes `unknown` (the app probably exited
 * before the task finished, so its exit code was never captured).
 */
export async function listDetachedBackgroundTasks(storageDir: string): Promise<BackgroundTaskRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(storageDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records = await Promise.all(
    entries.filter((entry) => entry.endsWith(BACKGROUND_TASK_RECORD_EXT)).map((entry) => readRecord(storageDir, entry))
  )
  return (
    await Promise.all(
      records
        .filter((record): record is BackgroundTaskRecord => record !== undefined)
        .map((record) => reconcileDetachedBackgroundTask(storageDir, record))
    )
  ).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

async function reconcileDetachedBackgroundTask(
  storageDir: string,
  record: BackgroundTaskRecord
): Promise<BackgroundTaskRecord> {
  if (record.status !== 'running') return record
  const completion = await readSentinel(storageDir, record.id)
  if (completion) {
    return { ...record, ...completion, status: completion.status }
  }
  if (record.pid > 0 && isPidAlive(record.pid)) return record
  if (record.stopRequestedAt) {
    return {
      ...record,
      status: 'stopped',
      signal: record.stopSignal ?? 'SIGTERM',
      finishedAt: record.finishedAt ?? new Date().toISOString(),
      note: 'The stopped process is no longer running; no completion event was captured.'
    }
  }
  return {
    ...record,
    status: 'unknown',
    note: 'Process is gone and no completion marker exists — the app likely exited while the task was running. Check the log file.'
  }
}

async function finalizeDetachedBackgroundTask(
  storageDir: string,
  record: BackgroundTaskRecord,
  onExit: StartDetachedBackgroundTaskInput['onExit'],
  status: BackgroundTaskCompletion['status'],
  exitCode: number | null,
  signal: string | null
): Promise<void> {
  await withRecordLock(record.id, async () => {
    try {
      const current = await readRecord(storageDir, `${record.id}${BACKGROUND_TASK_RECORD_EXT}`)
      if (current?.status === 'stopped') return
      if (current?.stopRequestedAt) status = 'stopped'
      const completion: BackgroundTaskCompletion = {
        id: record.id,
        status,
        exitCode,
        signal,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(record.startedAt),
        logFile: record.logFile
      }
      const finished: BackgroundTaskRecord = { ...(current ?? record), ...completion, note: undefined }
      await writeRecord(storageDir, finished)
      await writeFile(
        path.join(storageDir, `${record.id}${BACKGROUND_TASK_SENTINEL_EXT}`),
        JSON.stringify(completion, null, 2),
        { mode: 0o600 }
      )
      const summary = `Background task "${finished.name}" (${finished.id}) finished with ${
        signal ? `signal ${signal}` : `exit code ${exitCode ?? 'unknown'}`
      }. Log: ${finished.logFile}`
      logger.info('Detached background task finished', { taskId: finished.id, status, exitCode, signal })
      onExit?.({ record: finished, summary })
    } catch (error) {
      logger.error('Failed to finalize detached background task', { taskId: record.id, error })
    }
  })
}

function writeRecordSync(storageDir: string, record: BackgroundTaskRecord): void {
  writeFileSync(path.join(storageDir, `${record.id}${BACKGROUND_TASK_RECORD_EXT}`), JSON.stringify(record, null, 2), {
    mode: 0o600
  })
}

async function writeRecord(storageDir: string, record: BackgroundTaskRecord): Promise<void> {
  await writeFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_RECORD_EXT}`), JSON.stringify(record, null, 2), {
    mode: 0o600
  })
}

async function readRecord(storageDir: string, entry: string): Promise<BackgroundTaskRecord | undefined> {
  try {
    return JSON.parse(await readFile(path.join(storageDir, entry), 'utf8')) as BackgroundTaskRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    logger.warn('Unreadable background task record skipped', { entry, error })
    return undefined
  }
}

async function readSentinel(storageDir: string, taskId: string): Promise<BackgroundTaskCompletion | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(storageDir, `${taskId}${BACKGROUND_TASK_SENTINEL_EXT}`), 'utf8')
    ) as BackgroundTaskCompletion
  } catch {
    return undefined
  }
}
