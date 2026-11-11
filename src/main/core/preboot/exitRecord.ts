import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

import { loggerService } from '@logger'

const logger = loggerService.withContext('ExitRecord')

const RECORD_FILE = 'last-session.json'
export const HEARTBEAT_INTERVAL_MS = 5_000

/** How the process's own exit path was reached. */
type ExitOutcome = 'graceful' | 'forced'

interface ExitRecord {
  pid: number
  startedAt: string
  heartbeatAt: string
  memMB: number
  /**
   * Observed OS shutdown intent, persisted the moment it is known (before
   * asynchronous teardown). Lets the next launch report an interrupted system
   * shutdown instead of a kill when termination cuts cleanup short.
   */
  shutdownIntent?: string
  /** Present only when the process reached its exit path; absent means it was cut off. */
  exit?: { at: string; reason: string; outcome: ExitOutcome }
}

let record: ExitRecord | null = null
let recordPath: string | null = null
let exitReason: string | null = null
let exitOutcome: ExitOutcome = 'graceful'
let writeFailed = false

/**
 * Remember why the process is about to exit. Last call wins, because a quit
 * can be requested and then blocked before the real exit happens.
 */
export function noteExitReason(reason: string): void {
  exitReason = reason
  // PowerService releases the Windows shutdown barrier before quit's async
  // teardown runs, so persist an observed OS shutdown immediately: if
  // termination cuts teardown short, the next launch can still report the
  // system shutdown instead of a kill.
  if (reason === 'system-shutdown' && record && !record.exit) {
    record.shutdownIntent = reason
    writeRecord()
  }
}

/**
 * Mark the in-progress exit as forced (cleanup skipped by `forceExit()` or
 * truncated by the shutdown-timeout fuse). The requested reason is kept; only
 * the outcome changes, so the next launch does not report it as graceful.
 */
export function markExitForced(): void {
  exitOutcome = 'forced'
}

/**
 * Log how the previous session ended, then start recording this one: a
 * heartbeat every few seconds, and an exit marker written by `recordExit()`.
 * A record without an exit marker means the process died without running its
 * exit path (`taskkill /F`, OOM kill, native crash).
 *
 * Timing contract:
 *   - Must run after `requireSingleInstance()` so a second instance does not
 *     overwrite the live instance's record.
 *   - Safe to call once.
 */
export function trackProcessExit(): void {
  // Scope the record to the resolved userData profile: the single-instance
  // lock is keyed on it, so independently locked profiles never share one.
  // LOGS_DIR is app-name-based, so two packaged copies configured with
  // distinct userData directories would overwrite each other's record there.
  recordPath = path.join(app.getPath('userData'), RECORD_FILE)
  fs.mkdirSync(path.dirname(recordPath), { recursive: true })
  logPreviousExit(recordPath)

  const now = new Date().toISOString()
  record = { pid: process.pid, startedAt: now, heartbeatAt: now, memMB: currentMemMB() }
  writeRecord()

  setInterval(beat, HEARTBEAT_INTERVAL_MS).unref()
  // `app.exit()` does not emit this, so those paths call `recordExit()` themselves.
  process.on('exit', (code) => recordExit(`exit(${code})`))
}

/**
 * Write the exit marker and stop the heartbeat. Idempotent. `fallbackReason`
 * is used only when no reason was noted via `noteExitReason()`.
 */
export function recordExit(fallbackReason = 'unknown'): void {
  if (!record || record.exit) return
  delete record.shutdownIntent // the exit marker supersedes the intent
  record.exit = { at: new Date().toISOString(), reason: exitReason ?? fallbackReason, outcome: exitOutcome }
  writeRecord()
}

function beat(): void {
  if (!record || record.exit) return
  record.heartbeatAt = new Date().toISOString()
  record.memMB = currentMemMB()
  writeRecord()
}

function currentMemMB(): number {
  return Math.round(process.memoryUsage.rss() / 1024 / 1024)
}

function writeRecord(): void {
  if (!record || !recordPath) return
  try {
    fs.writeFileSync(recordPath, JSON.stringify(record))
  } catch (error) {
    if (writeFailed) return
    writeFailed = true
    logger.warn('Failed to write exit record', error as Error)
  }
}

function logPreviousExit(file: string): void {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('previous exit: unknown (record unreadable)', error as Error)
    }
    return
  }

  let previous: Partial<ExitRecord>
  try {
    previous = JSON.parse(raw)
  } catch {
    logger.warn('previous exit: killed without graceful shutdown (record was truncated mid-write)')
    return
  }

  if (previous.exit) {
    const { at, reason } = previous.exit
    // Records written before outcomes existed only had graceful exit paths.
    const outcome = previous.exit.outcome ?? 'graceful'
    if (reason === 'system-shutdown') {
      logger.info(`previous exit: system shutdown (at ${at})`)
    } else if (outcome === 'forced') {
      logger.warn(`previous exit: forced (${reason}) (at ${at})`)
    } else {
      logger.info(`previous exit: graceful (${reason}) (at ${at})`)
    }
    return
  }

  if (previous.shutdownIntent === 'system-shutdown') {
    logger.warn(
      `previous exit: system shutdown interrupted during cleanup (last heartbeat ${previous.heartbeatAt}, pid ${previous.pid})`
    )
    return
  }

  logger.warn(
    `previous exit: killed without graceful shutdown (last heartbeat ${previous.heartbeatAt}, pid ${previous.pid}, ${previous.memMB} MB)`
  )
}
