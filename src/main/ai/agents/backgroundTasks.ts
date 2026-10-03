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

import { execFile, execFileSync, spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

export type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

const logger = loggerService.withContext('AgentBackgroundTasks')
const execFileAsync = promisify(execFile)
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

/**
 * Windows detach and log capture cannot share one shell hop: a `DETACHED_PROCESS` `cmd.exe`
 * never hands its stdio to the processes it starts, while an attached task dies with the app.
 * Running the command from a detached Node process keeps the shell ordinary, so both hold.
 * The command travels as `argv[1]` so a long one cannot overflow the Windows environment block.
 */
export const WINDOWS_DETACHED_TASK_RUNNER = [
  `const { spawn } = require('node:child_process')`,
  `const env = { ...process.env }`,
  `delete env.ELECTRON_RUN_AS_NODE`,
  `const task = spawn(process.argv[1], { shell: true, stdio: 'inherit', env })`,
  `task.on('error', () => process.exit(1))`,
  `task.on('exit', (code) => process.exit(code ?? 1))`
].join(';')

export interface DetachedBackgroundTaskSpawn {
  file: string
  args: string[]
  options: SpawnOptions
}

/** Pure spawn factory so the detach contract is assertable without spawning. */
export function buildDetachedBackgroundTaskSpawn(
  command: string,
  cwd: string,
  stdoutFd: number,
  stderrFd: number
): DetachedBackgroundTaskSpawn {
  const options: SpawnOptions = {
    cwd,
    // POSIX needs setsid so `kill(-pid)` reaches the whole tree; on Windows the flag itself is
    // what keeps the task running once Cherry Studio exits.
    detached: true,
    windowsHide: true,
    // stdin closed, stdout and stderr both point at the task log fd.
    stdio: ['ignore', stdoutFd, stderrFd]
  }
  if (process.platform === 'win32') {
    return {
      file: process.execPath,
      args: ['-e', WINDOWS_DETACHED_TASK_RUNNER, command],
      options: { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    }
  }
  return { file: command, args: [], options: { ...options, shell: true } }
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
  try {
    const target = buildDetachedBackgroundTaskSpawn(command, input.cwd, logHandle.fd, logHandle.fd)
    const child = spawn(target.file, target.args, target.options)
    child.unref()

    const record: BackgroundTaskRecord = {
      id,
      name: input.name?.trim() || t('background_task.name.unnamed'),
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
    // 'close' rather than 'exit': it waits for the task's stdio to drain, so the final log
    // bytes are readable by the time completion is published.
    child.on('close', (code, signal) => finalize(code === 0 ? 'completed' : 'failed', code, signal))

    // Synchronously, so an immediately-exiting task cannot finalize before the
    // running record exists on disk.
    try {
      writeRecordSync(input.storageDir, record)
    } catch (error) {
      settled = true
      activeTaskPids.delete(id)
      let cleaned = record.pid <= 0
      try {
        if (!cleaned) {
          if (process.platform === 'win32') {
            await execTaskkill(['/PID', String(record.pid), '/T', '/F'])
          } else {
            process.kill(-record.pid, 'SIGKILL')
          }
          cleaned = true
        }
      } catch (stopError) {
        // The process is still alive with no record to stop it through, so write one. It stays
        // `running`, which is what it is: `unknown` is the one status every control path excludes,
        // so an untracked record marked that way could be seen but never stopped, and a permanent
        // agent deletion would sweep past it.
        logger.error('Could not stop unrecorded detached task; recording it so it stays controllable', {
          taskId: id,
          pid: record.pid,
          stopError
        })
        try {
          writeRecordSync(input.storageDir, { ...record, note: t('background_task.note.untracked') })
          activeTaskPids.set(id, record.pid)
        } catch (recordError) {
          logger.error('Detached background task is untracked and could not be recorded', {
            taskId: id,
            pid: record.pid,
            recordError
          })
        }
      }
      throw error
    }

    logger.info('Detached background task started', { taskId: id, pid: record.pid })
    return record
  } finally {
    // The child holds its own dup of this fd, so ours can go as soon as it exists.
    await logHandle.close()
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
  force = false,
  onExit?: (task: CompletedBackgroundTask) => void
): Promise<BackgroundTaskRecord | undefined> {
  return withRecordLock(taskId, () => stopDetachedBackgroundTaskUnlocked(storageDir, taskId, force, onExit))
}

async function stopDetachedBackgroundTaskUnlocked(
  storageDir: string,
  taskId: string,
  force: boolean,
  onExit?: (task: CompletedBackgroundTask) => void
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
    note: force ? t('background_task.note.kill_requested') : t('background_task.note.stop_requested')
  }
  await writeRecord(storageDir, requested)
  try {
    if (process.platform === 'win32') {
      await execTaskkill(['/PID', String(record.pid), '/T', ...(force ? ['/F'] : [])])
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
  // The process is dead and the record says so. A sentinel that cannot be written is only a
  // degraded restart-time reconciliation, so it must not turn a completed kill into an error or
  // suppress the one notification this termination path sends.
  await writeSentinel(storageDir, record.id, completion)
  // A kill ends the task without the child ever reporting an exit, so nothing else will announce
  // it: the configured channels would otherwise stay silent about work the user asked to end.
  onExit?.({
    record: stopped,
    summary: t('background_task.summary_killed', { name: stopped.name, id: stopped.id, log: stopped.logFile })
  })
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
  if (record.pid > 0 && isPidAlive(record.pid)) {
    return isRecycledPid(record)
      ? { ...record, status: 'unknown', note: t('background_task.note.gone_no_marker') }
      : record
  }
  if (record.stopRequestedAt) {
    return {
      ...record,
      status: 'stopped',
      signal: record.stopSignal ?? 'SIGTERM',
      finishedAt: record.finishedAt ?? new Date().toISOString(),
      note: t('background_task.note.stopped_no_event')
    }
  }
  return {
    ...record,
    status: 'unknown',
    note: t('background_task.note.gone_no_marker')
  }
}

/**
 * A live pid is only this task's pid while its recorded start stamp still matches. After a restart
 * the in-memory ownership is gone, so a pid the OS has since handed to something else is what makes
 * a dead record read as running — and the stop path then refuses it as unsafe to signal.
 */
function isRecycledPid(record: BackgroundTaskRecord): boolean {
  if (!record.pidStartTime || activeTaskPids.get(record.id) === record.pid) return false
  const observed = getPidStartTime(record.pid)
  return observed !== undefined && observed !== record.pidStartTime
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
      await writeSentinel(storageDir, record.id, completion)
      const summary = t('background_task.summary_finished', {
        name: finished.name,
        id: finished.id,
        outcome: signal
          ? t('background_task.summary_signal', { signal })
          : t('background_task.summary_exit_code', { code: exitCode ?? t('background_task.summary_unknown_code') }),
        log: finished.logFile
      })
      logger.info('Detached background task finished', { taskId: finished.id, status, exitCode, signal })
      onExit?.({ record: finished, summary })
    } catch (error) {
      logger.error('Failed to finalize detached background task', { taskId: record.id, error })
    }
  })
}

/**
 * The Windows platform kill, awaited rather than run inline: `taskkill` on a hung process takes its
 * whole five-second timeout, and the main process drives both the UI and every other detached task,
 * so one blocking call at a time would serialise the whole sweep onto that timeout.
 */
function execTaskkill(args: string[]): Promise<unknown> {
  return execFileAsync('taskkill', args, { timeout: 5_000 })
}

function recordPath(storageDir: string, taskId: string): string {
  return path.join(storageDir, `${taskId}${BACKGROUND_TASK_RECORD_EXT}`)
}

/**
 * Written to a sibling and renamed, never truncated in place: a rewrite that is interrupted leaves
 * the previous record readable, so a live task cannot become undiscoverable while it still runs.
 */
function writeRecordSync(storageDir: string, record: BackgroundTaskRecord): void {
  const target = recordPath(storageDir, record.id)
  const staging = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(staging, JSON.stringify(record, null, 2), { mode: 0o600 })
    renameSync(staging, target)
  } catch (error) {
    rmSync(staging, { force: true })
    throw error
  }
}

async function writeRecord(storageDir: string, record: BackgroundTaskRecord): Promise<void> {
  const target = recordPath(storageDir, record.id)
  const staging = `${target}.${process.pid}.tmp`
  try {
    await writeFile(staging, JSON.stringify(record, null, 2), { mode: 0o600 })
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

/**
 * Best-effort. The record is the live state and the sentinel only sharpens what a later restart
 * infers, so a sentinel that cannot be written degrades reconciliation instead of failing a
 * completion that has already happened.
 */
async function writeSentinel(storageDir: string, taskId: string, completion: BackgroundTaskCompletion): Promise<void> {
  try {
    await writeFile(
      path.join(storageDir, `${taskId}${BACKGROUND_TASK_SENTINEL_EXT}`),
      JSON.stringify(completion, null, 2),
      { mode: 0o600 }
    )
  } catch (error) {
    logger.error('Failed to write detached background task completion sentinel', { taskId, error })
  }
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
