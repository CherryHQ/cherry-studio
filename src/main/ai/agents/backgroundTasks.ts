/**
 * Detached background tasks for agent sessions.
 *
 * Unlike the runtime-native background shells (e.g. Claude Code's
 * `run_in_background`), whose processes live inside the CLI child-process tree
 * and die with the CLI session, tasks started here are spawned into their own
 * session (Node `detached: true`; libuv calls `setsid()` on POSIX) and keep
 * running across session turns, CLI exits, and app restarts.
 *
 * Durability is file-based on purpose: every task gets a JSON record, a merged
 * log file, and — once it exits while the app was alive — a `<id>.done`
 * sentinel. Any later session reconciles state from those files; nothing lives
 * only in process memory. DB-backed records are future work.
 */

import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('AgentBackgroundTasks')

export const BACKGROUND_TASK_RECORD_EXT = '.json'
export const BACKGROUND_TASK_LOG_EXT = '.log'
export const BACKGROUND_TASK_SENTINEL_EXT = '.done'

export const MAX_BACKGROUND_TASK_COMMAND_LENGTH = 10_000

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'unknown'

export interface BackgroundTaskRecord {
  id: string
  name: string
  command: string
  pid: number
  cwd: string
  startedAt: string
  logFile: string
  status: BackgroundTaskStatus
  exitCode: number | null
  signal: string | null
  finishedAt?: string
  durationMs?: number
  /** Present on `unknown` records: why the final state could not be determined. */
  note?: string
}

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
    // stdin closed; stdout and stderr share the task log fd. Writing straight
    // to the file (no pipes) means no drain race on exit.
    stdio: ['ignore', stdoutFd, stderrFd]
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
  try {
    const child = spawn(command, buildDetachedBackgroundTaskSpawnOptions(input.cwd, logHandle.fd, logHandle.fd))
    child.unref()

    const record: BackgroundTaskRecord = {
      id,
      name: input.name?.trim() || 'background task',
      command,
      pid: child.pid ?? -1,
      cwd: input.cwd,
      startedAt,
      logFile,
      status: 'running',
      exitCode: null,
      signal: null
    }

    // 'error' (e.g. ENOENT) and 'exit' are mutually exclusive for spawn
    // failures; finalize guards so at most one completion lands. Handlers go
    // on before any await — both events can fire on the first ticks.
    let settled = false
    const finalize = (status: BackgroundTaskCompletion['status'], exitCode: number | null, signal: string | null) => {
      if (settled) return
      settled = true
      void finalizeDetachedBackgroundTask(input.storageDir, record, input.onExit, status, exitCode, signal)
    }
    child.on('error', (error) => {
      logger.warn('Detached background task failed to spawn', { taskId: id, error })
      finalize('failed', null, null)
    })
    child.on('exit', (code, signal) => finalize(code === 0 ? 'completed' : 'failed', code, signal))

    // Synchronously, so an immediately-exiting task cannot finalize before the
    // running record exists on disk.
    writeRecordSync(input.storageDir, record)

    logger.info('Detached background task started', { taskId: id, pid: record.pid })
    return record
  } finally {
    // The child holds its own dup of this fd; closing ours does not cut its log.
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
  try {
    const completion: BackgroundTaskCompletion = {
      id: record.id,
      status,
      exitCode,
      signal,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - Date.parse(record.startedAt),
      logFile: record.logFile
    }
    const finished: BackgroundTaskRecord = { ...record, ...completion }
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
