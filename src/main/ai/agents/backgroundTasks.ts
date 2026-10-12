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
import { access, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

export type { BackgroundTaskRecord, BackgroundTaskStatus } from '@shared/ai/backgroundTask'

const logger = loggerService.withContext('AgentBackgroundTasks')
const execFileAsync = promisify(execFile)
/**
 * Groups this app has verified as a task's own work: task id → the group and the members whose
 * identity it has established. A member is verified only with evidence tying it to the task — the
 * leader this app spawned, or descent from one it has already verified — never by its mere presence
 * behind the recorded pgid: that number alone survives the group, and whatever the OS hands it to
 * next is not this task's to signal.
 */
const ownedTaskGroups = new Map<string, OwnedGroup>()
const recordLocks = new Map<string, Promise<void>>()

interface OwnedGroup {
  pgid: number
  /** Verified members: pid → the start stamp they were verified under. */
  members: Map<number, string>
}

/** Accounts for the group's live members that can be verified as this task's own work. */
function trackVerifiedMembers(taskId: string): void {
  const owned = ownedTaskGroups.get(taskId)
  if (!owned) return
  const live = readGroupMembers(owned.pgid)
  if (!live) return
  verifyMembers(owned, live)
}

/**
 * Accounts for every live member of the group, whatever its parentage: called only where the group
 * membership provably is the task's own — the leader's close, when nothing that outlived it could
 * have come from anywhere else.
 */
function trackAllLiveMembers(taskId: string): void {
  const owned = ownedTaskGroups.get(taskId)
  if (!owned) return
  const live = readGroupMembers(owned.pgid)
  if (!live) return
  for (const member of live) owned.members.set(member.pid, member.lstart)
}

/**
 * Adds the verifiable members of `live` to the group's verified set. While the leader this app
 * spawned (matched by its start stamp, not just its pid) is alive, everything in its group is its
 * own work: a process only joins a group inside its own session, so a live leader holds every
 * member to its descent. Once the leader is gone that argument is spent, and a member is the
 * task's only through a parent this app has already verified — which is also what refuses a
 * replacement group that took the pgid after the task's own members drained: nothing in it traces
 * back to anything this app verified.
 */
function verifyMembers(owned: OwnedGroup, live: Array<GroupMember>): void {
  const byPid = new Map(live.map((member) => [member.pid, member]))
  const leader = byPid.get(owned.pgid)
  if (leader && owned.members.get(leader.pid) === leader.lstart) {
    for (const member of live) owned.members.set(member.pid, member.lstart)
    return
  }
  for (let expanded = true; expanded;) {
    expanded = false
    for (const member of live) {
      if (owned.members.get(member.pid) === member.lstart) continue
      const parent = byPid.get(member.ppid)
      if (parent && owned.members.get(parent.pid) === parent.lstart) {
        owned.members.set(member.pid, member.lstart)
        expanded = true
      }
    }
  }
}

/**
 * Whether every live member of the group is one this app has verified as the task's own work, so
 * the group signal below can only reach the task. An unreadable table establishes nothing and a
 * member this app cannot account for is refused outright: the signal is skipped, the record stays.
 */
function isGroupOwnershipVerified(taskId: string): boolean {
  const owned = ownedTaskGroups.get(taskId)
  if (!owned) return false
  const live = readGroupMembers(owned.pgid)
  if (!live) return false
  verifyMembers(owned, live)
  return live.every((member) => owned.members.get(member.pid) === member.lstart)
}

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

/** How often a leaderless group is polled for its last member's exit. */
const LEADERLESS_GROUP_POLL_MS = 250
/** How long a forced stop waits for the group to drain before treating a member as a survivor. */
const STOP_DRAIN_TIMEOUT_MS = 3_000
const STOP_DRAIN_POLL_MS = 50

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
  /**
   * Channel IDs whose chats may receive the completion notice. Persisted on the record so
   * delivery after the starting turn stays inside that turn's authorized recipients.
   */
  notifyChannelIds?: readonly string[]
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

/**
 * `kill(pid, 0)` liveness probe; EPERM means the pid exists but is not ours. Non-positive values
 * are not pids at all — `process.kill` reads 0 and negatives as whole process groups — so nothing
 * may be reported alive through them, especially not a pid that failed to parse.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
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
      signal: null,
      ...(input.notifyChannelIds ? { notifyChannelIds: [...input.notifyChannelIds] } : {})
    }
    // The leader is verified by the start stamp captured from it while spawning, and its members
    // get verified as the group works: the pulse below, and the leader's close once it is gone.
    if (record.pid > 0) {
      const members = new Map<number, string>()
      if (record.pidStartTime) members.set(record.pid, record.pidStartTime)
      ownedTaskGroups.set(id, { pgid: record.pid, members })
    }

    // A spawn failure can emit both 'error' and 'close'; finalize guards so
    // at most one completion lands. Handlers go
    // on before any await — both events can fire on the first ticks.
    // Taking stock on a pulse while the group works: a member is only the task's while this app can
    // still tie it to one it has verified, and that tie is easiest to establish while its parent
    // lives. The Windows kill targets the pid tree instead, so there is nothing to verify there.
    const taking =
      process.platform === 'win32' ? undefined : setInterval(() => trackVerifiedMembers(id), LEADERLESS_GROUP_POLL_MS)
    taking?.unref?.()
    let settled = false
    // The completion the leader's handler observed. A member it backgrounded (`sleep 1 &`) can
    // outlive that handler, so the observation is held until the group drains. The recovery path
    // spends `settled` before its record exists; this is what it replays afterwards.
    let observedCompletion:
      | { status: BackgroundTaskCompletion['status']; exitCode: number | null; signal: string | null }
      | undefined
    // Publishes the observed completion once the task's group holds no live member. A live
    // member keeps both the completion and the ownership — the only thing that makes a
    // leaderless group verifiably this task's — so Stop/Kill stays reachable and the completion
    // lands as observed, with the leader's own exit evidence, once the group drains.
    const settleThroughGroupDrain = async (): Promise<void> => {
      if (process.platform !== 'win32' && record.pid > 0 && groupHasLiveMember(record.pid)) {
        const poll = setTimeout(() => void settleThroughGroupDrain(), LEADERLESS_GROUP_POLL_MS)
        poll.unref?.()
        return
      }
      if (taking) clearInterval(taking)
      ownedTaskGroups.delete(id)
      const completion = observedCompletion
      if (completion) {
        await finalizeDetachedBackgroundTask(
          input.storageDir,
          record,
          input.onExit,
          completion.status,
          completion.exitCode,
          completion.signal
        )
      }
    }
    const finalize = (status: BackgroundTaskCompletion['status'], exitCode: number | null, signal: string | null) => {
      observedCompletion = { status, exitCode, signal }
      if (settled) return
      settled = true
      void settleThroughGroupDrain()
    }
    child.on('error', (error) => {
      logger.warn('Detached background task failed to spawn', { taskId: id, error })
      finalize('failed', null, null)
    })
    // 'close' rather than 'exit': it waits for the task's stdio to drain, so the final log
    // bytes are readable by the time completion is published. The members that outlived the leader
    // are still provably its own at this instant — nothing outside its session could have joined
    // the group — so their identity is taken here, before the leader is gone as evidence.
    child.on('close', (code, signal) => {
      trackAllLiveMembers(id)
      finalize(code === 0 ? 'completed' : 'failed', code, signal)
    })

    // Synchronously, so an immediately-exiting task cannot finalize before the
    // running record exists on disk.
    try {
      writeRecordSync(input.storageDir, record)
    } catch (error) {
      settled = true
      if (taking) clearInterval(taking)
      ownedTaskGroups.delete(id)
      let cleaned = record.pid <= 0
      // A group member that survived the cleanup kill — a privileged worker failing the credential
      // check while the shell died. It outranks the leader's own exit in the message below.
      let survivor = false
      try {
        if (!cleaned) {
          if (process.platform === 'win32') {
            await execTaskkill(['/PID', String(record.pid), '/T', '/F'])
          } else {
            try {
              process.kill(-record.pid, 'SIGKILL')
            } catch (killError) {
              // macOS answers EPERM for a process group holding only exited-but-unreaped
              // children — proof the group has nothing left to signal — but also when every
              // live member fails the credential check (a setuid `sudo` the task exec'd), so
              // the errno alone cannot tell an exit from a refusal: no live member can.
              if ((killError as NodeJS.ErrnoException).code !== 'EPERM' || groupHasLiveMember(record.pid)) {
                throw killError
              }
            }
            // A delivered group SIGKILL still proves nothing per member, so the forced-stop path
            // verifies the drain too: a privileged worker survives while the shell dies, and this
            // path has already disabled ownership and finalization — a survivor read as cleaned
            // would run on with nothing tracking it and nothing able to stop it.
            if (!(await waitForGroupDrain(record.pid))) {
              survivor = true
              throw new Error(`process group ${record.pid} still holds live members after SIGKILL`)
            }
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
          // This record is real and reads `running`, so it owes the completion `settled` spent
          // before it existed — otherwise the task never reports and the record sits at `running`.
          settled = false
          // Ownership returns before any replay: a live group member keeps it — the group, not
          // the leader, is the task — so the leader's close event having fired must not suppress
          // it, or a leaderless group folds to `unknown` and loses Stop/Kill. The drain-gated
          // settle releases it again once the group is empty. Whatever still holds the group here
          // survived the cleanup kill this call just sent, so it is taken as the task's own.
          const members = new Map<number, string>()
          if (record.pidStartTime) members.set(record.pid, record.pidStartTime)
          ownedTaskGroups.set(id, { pgid: record.pid, members })
          trackAllLiveMembers(id)
          if (observedCompletion) {
            const { status, exitCode, signal } = observedCompletion
            finalize(status, exitCode, signal)
          }
        } catch (recordError) {
          logger.error('Detached background task is untracked and could not be recorded', {
            taskId: id,
            pid: record.pid,
            recordError
          })
        }
      }
      // A plain "start failed" here invites a retry that duplicates work that is in fact still
      // running, so the task may only be described as still running while that holds. Both of the
      // facts it rests on are about the process rather than the record, and neither depends on the
      // write above succeeding: `cleaned` means this call killed it, `observedCompletion` means the
      // one close listener — spent, so it will not fire again — saw it exit, and `survivor` outranks
      // that observation, which reports the leader only. Deriving it from the record instead let a
      // task that provably exited be announced as running, because the entry condition of this
      // whole recovery is a write failing, and one failing write rarely means the next succeeds.
      const stillRunning = (!cleaned && !observedCompletion) || survivor
      throw new Error(
        stillRunning
          ? `Detached background task ${id} is still running (pid ${record.pid}) and its record could not be written`
          : cleaned
            ? `Detached background task ${id} could not record its start and was stopped (pid ${record.pid})`
            : `Detached background task ${id} could not record its start but has already finished (${observedCompletion!.status})`,
        { cause: error }
      )
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

/**
 * Whether the record's process group may be signalled. It is asked twice by the stop below — once
 * before the record write and once after it — so nothing here may assume the process table it read
 * a moment ago still describes the same processes.
 */
function isGroupSignalable(record: BackgroundTaskRecord): boolean {
  const liveChild = ownedTaskGroups.get(record.id)?.pgid === record.pid
  if (process.platform === 'win32') return liveChild
  if (!liveChild) {
    // After a restart only numbers tie the record to a process. A live leader is still provably
    // this task's by start stamp; a leaderless group is not — a reused pgid can hold unrelated
    // live workers — so it stays signalable only through the ownership the spawn retained.
    if (!isPidAlive(record.pid)) return false
    if (!record.pidStartTime || getPidStartTime(record.pid) !== record.pidStartTime) return false
    return true
  }
  return isGroupOwnershipVerified(record.id)
}

async function stopDetachedBackgroundTaskUnlocked(
  storageDir: string,
  taskId: string,
  force: boolean,
  onExit?: (task: CompletedBackgroundTask) => void
): Promise<BackgroundTaskRecord | undefined> {
  const record = await getDetachedBackgroundTask(storageDir, taskId)
  if (!record || record.status !== 'running' || record.pid <= 0) return undefined
  // Ownership alone is not enough to signal with: the entry outlives the shell, and a pgid the
  // task's own members have drained from is free to hold whatever the OS gives it next. Every live
  // member must be verified as this task's own first, or the signal is refused and the record —
  // unresolved, and still stoppable once the group's identity is established — stays as it is.
  // A recycled PID could belong to another application: old records without a start stamp cannot be
  // signalled safely after restart; newly created tasks always capture one on POSIX.
  if (!isGroupSignalable(record)) {
    logger.warn('Refusing to signal a group holding members this task cannot account for', {
      taskId: record.id,
      pgid: record.pid
    })
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
  // The write above is a promise, and the identity it was cleared against can turn over while it
  // resolves: the task exits and the OS hands its pid and pgid to processes this app never started.
  // The record lock orders writers, not process identity, so the group is re-established here —
  // against the same evidence as before, and as close to the signal as the language allows. It
  // narrows this window; it does not make the signal atomic against a reuse that starts later.
  if (!isGroupSignalable(record)) {
    logger.warn('Refusing to signal a group whose identity changed while the stop was recorded', {
      taskId: record.id,
      pgid: record.pid
    })
    await writeRecord(storageDir, record)
    return undefined
  }
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
  // A delivered group SIGKILL still proves nothing per member: a privileged worker (an
  // authorized noninteractive sudo) fails the credential check and survives while the shell
  // dies. The record may only say `stopped` once no live member remains — reconciliation and
  // the permanent purge trust that word, and a survivor would lose its tracking and controls.
  if (process.platform !== 'win32' && !(await waitForGroupDrain(record.pid))) {
    return (await getDetachedBackgroundTask(storageDir, taskId)) ?? requested
  }
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
 * Whether the process group still holds a member the OS schedules. A group kill answers EPERM
 * both when every member has exited unreaped and when every live member fails the credential
 * check (a setuid `sudo` the task exec'd), so the exit is only proven once nothing is alive.
 * An unreadable table is not an empty group: nothing about the task has been established.
 */
function groupIsEmpty(pgid: number): boolean {
  const members = readGroupMembers(pgid)
  return members !== null && members.length === 0
}

function groupHasLiveMember(pgid: number): boolean {
  return !groupIsEmpty(pgid)
}

/** A live member of a process group: its pid, its parent, and the start stamp identifying it. */
interface GroupMember {
  pid: number
  ppid: number
  lstart: string
}

/**
 * All the members of `pgid` the OS still schedules, each with the parent and start stamp that
 * identify it — the evidence a member descends from one this app verified rather than from a pid
 * the OS handed to someone else. `null` when the table cannot be read, which is never evidence of
 * anything.
 */
function readGroupMembers(pgid: number): GroupMember[] | null {
  try {
    const table = execFileSync('ps', ['-axwwo', 'pgid=,pid=,ppid=,state=,lstart='], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5_000
    })
    const members: GroupMember[] = []
    for (const row of table.split('\n')) {
      const fields = row.trim().split(/\s+/)
      if (fields.length < 9 || Number(fields[0]) !== pgid) continue
      const state = fields[3]
      if (!state || state.startsWith('Z')) continue
      members.push({ pid: Number(fields[1]), ppid: Number(fields[2]), lstart: fields.slice(-5).join(' ') })
    }
    return members
  } catch {
    return null
  }
}

/**
 * Whether live processes still sit in the record's process group while this app holds no
 * ownership of it. A pgid is only a number — once the original group has fully exited the OS is
 * free to hand the same one to an unrelated group, so after a restart such members cannot be
 * attributed to the task and must not be treated as its workers.
 */
export function hasUnownedLiveGroup(record: BackgroundTaskRecord): boolean {
  if (process.platform === 'win32' || record.pid <= 0) return false
  if (ownedTaskGroups.get(record.id)?.pgid === record.pid) return false
  return groupHasLiveMember(record.pid)
}

/**
 * Bounded wait for the group's last member to disappear. Group-signal delivery is per member:
 * a survivor failing the credential check keeps the group alive after a successful kill, so
 * only an empty group proves the task has ended.
 */
async function waitForGroupDrain(pgid: number): Promise<boolean> {
  const deadline = Date.now() + STOP_DRAIN_TIMEOUT_MS
  while (!groupIsEmpty(pgid)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, STOP_DRAIN_POLL_MS))
  }
  return true
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
  // The leader is gone but its group can still be working (a member ignoring SIGTERM) — the
  // task stays running and controllable, but only while this app still owns the group from the
  // spawn: a pgid is a plain number, and one a restart no longer owns can have been reused by
  // an unrelated group, whose members are not the task's to signal. Such a record reads
  // `unknown`, the one status every control path excludes.
  if (process.platform !== 'win32' && record.pid > 0 && groupHasLiveMember(record.pid)) {
    return ownedTaskGroups.get(record.id)?.pgid === record.pid
      ? record
      : { ...record, status: 'unknown', note: t('background_task.note.group_unattributed') }
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
 * A live pid is only this task's pid while its recorded start stamp still matches — in-memory
 * ownership is no answer here, since the pid can outlive the task and be handed to something else
 * while this app still holds the entry. A mismatched stamp is what makes a dead record read as
 * running, and the stop path then refuses it as unsafe to signal.
 */
function isRecycledPid(record: BackgroundTaskRecord): boolean {
  if (!record.pidStartTime) return false
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
      if (!current) {
        // The record is gone (purged with the agent, or the spawn write failed) — a late exit must
        // not resurrect files or notify. A present-but-unreadable record still falls through.
        try {
          await access(recordPath(storageDir, record.id))
        } catch {
          logger.info('Detached background task record is gone; skipping completion persistence', {
            taskId: record.id
          })
          return
        }
      }
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
