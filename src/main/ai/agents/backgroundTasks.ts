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
  /** Whether this app has reaped the leader it spawned; its pid is the OS's to reuse from then on. */
  leaderReaped: boolean
}

/** Accounts for the group's live members that can be verified as this task's own work. */
function trackVerifiedMembers(taskId: string, storageDir?: string): void {
  const owned = ownedTaskGroups.get(taskId)
  if (!owned) return
  const live = readGroupMembers(owned.pgid)
  if (!live) return
  const adopted = adoptGroupLeader(owned, live)
  verifyMembers(owned, live)
  // Persist what the spawn could not capture, so a later restart can re-identify the leader from
  // the record alone and a permanent purge can still discover and stop the task.
  if (adopted && storageDir) void persistPidStartTime(taskId, storageDir, owned)
}

/**
 * Seeds the group's leader from the table when the spawn could not stamp it. Its start stamp is
 * the seed every member is verified from, so without one `verifyMembers` can never extend and the
 * task is permanently unownable: Stop/Kill stays refused while it runs, restart has no persisted
 * identity, and a permanent purge cannot discover it. This recovers it while the leader is still
 * alive in the group it leads — the one moment the numbers provably name this task's supervisor.
 * Returns whether a seed was established.
 */
function adoptGroupLeader(owned: OwnedGroup, live: Array<GroupMember>): boolean {
  // While the spawned leader is unreaped the OS cannot hand its pid to anyone else, so a live
  // process reading at that number still is the supervisor. Once it is reaped the number is in
  // circulation again, and adopting whatever sits there vouches for a group that is not this
  // task's — which is what lets Stop/Kill or a purge signal unrelated work.
  if (owned.leaderReaped || owned.members.size > 0) return false
  for (const member of live) {
    if (member.pid === owned.pgid) {
      owned.members.set(member.pid, member.lstart)
      return true
    }
  }
  return false
}

/**
 * Writes the recovered leader stamp back onto the record. Best-effort like every other index
 * write — the in-memory ownership already holds it, so a failed write costs only the restart
 * path, never the live one.
 */
async function persistPidStartTime(taskId: string, storageDir: string, owned: OwnedGroup): Promise<void> {
  const stamp = owned.members.get(owned.pgid)
  if (!stamp) return
  try {
    await withRecordLock(taskId, async () => {
      const current = await readRecord(storageDir, `${taskId}${BACKGROUND_TASK_RECORD_EXT}`)
      // A record already carrying a stamp needs no rewrite, and one that has settled terminal
      // must not be pushed back to `running` by a late recovery.
      if (!current || current.pidStartTime || current.status !== 'running') return
      await writeRecord(storageDir, { ...current, pidStartTime: stamp })
    })
  } catch (error) {
    logger.warn('Failed to persist the recovered background task identity', { taskId, error })
  }
}

/**
 * Adds the verifiable members of `live` to the group's verified set. The supervisor this app
 * spawned is the session and group leader, and it stays alive until the group holds no other live
 * member — so while it lives, its own start stamp vouches for every member of the group, including
 * one forked by a worker that has since exited, which no parent-chain walk could reach. Once it is
 * gone the group is empty, so the only members left to account for belong to a group that took the
 * drained pgid: nothing in it traces back to anything this app verified, and it is refused.
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
  adoptGroupLeader(owned, live)
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
/** Shell pid the Windows runner records at spawn, so a stop can walk past the shell's exit. */
export const BACKGROUND_TASK_EVIDENCE_EXT = '.pids'

export const MAX_BACKGROUND_TASK_COMMAND_LENGTH = 10_000

/** How often a leaderless group is polled for its last member's exit. */
const LEADERLESS_GROUP_POLL_MS = 250
/** How long a forced stop waits for the group to drain before treating a member as a survivor. */
const STOP_DRAIN_TIMEOUT_MS = 3_000
const STOP_DRAIN_POLL_MS = 50
/** How long a Windows stop waits for the runner's spawn evidence before it may signal the runner. */
const TASK_EVIDENCE_WAIT_TIMEOUT_MS = 6_000
const TASK_EVIDENCE_WAIT_POLL_MS = 100

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
 * The keeper that gives a Windows task durable membership. A process-table walk can only see what
 * a sample happens to contain, so a worker whose intermediate parent starts and exits between two
 * samples is unattributable no matter how the walk is written. A Job Object is the OS holding the
 * membership instead: a process joins by inheriting it from its creator, so it stays a member
 * however briefly or invisibly its parents lived.
 *
 * It is written to the task directory before the runner starts; the runner hands the keeper its
 * own pid and waits for it to report the job held before it spawns the shell, because membership
 * is inherited at creation and never retroactively. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` makes the
 * keeper the task's containment: the stop destroys it together with the runner, the last handle
 * closes, and every member still alive goes with it.
 */
const WINDOWS_DETACHED_TASK_JOB_KEEPER = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CherryBackgroundJob
{
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returned);
    [DllImport("kernel32", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool MoveFileEx(string existing, string replacement, uint flags);

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    const int ExtendedLimitInformationClass = 9;
    const int BasicProcessIdListClass = 3;
    const uint KillOnJobClose = 0x2000;
    const uint MoveFileReplaceExisting = 0x1;
    const uint MoveFileWriteThrough = 0x8;
    const uint ProcessSetQuota = 0x0100;
    const uint ProcessTerminate = 0x0001;

    public static IntPtr Create()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        ExtendedLimitInformation limits = new ExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
        int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, ExtendedLimitInformationClass, buffer, (uint)size))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return job;
    }

    public static bool Assign(IntPtr job, int pid)
    {
        IntPtr process = OpenProcess(ProcessSetQuota | ProcessTerminate, false, pid);
        if (process == IntPtr.Zero) return false;
        try
        {
            return AssignProcessToJobObject(job, process);
        }
        finally
        {
            CloseHandle(process);
        }
    }

    public static int[] Pids(IntPtr job)
    {
        int capacity = 4096;
        int size = 8 + capacity * IntPtr.Size;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            for (int i = 0; i < size; i++) Marshal.WriteByte(buffer, i, 0);
            uint returned;
            if (!QueryInformationJobObject(job, BasicProcessIdListClass, buffer, (uint)size, out returned))
                return null;
            int count = Marshal.ReadInt32(buffer, 4);
            if (count > capacity) count = capacity;
            int[] pids = new int[count];
            for (int i = 0; i < count; i++)
                pids[i] = (int)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
            return pids;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static bool Publish(string staging, string target)
    {
        return MoveFileEx(staging, target, MoveFileReplaceExisting | MoveFileWriteThrough);
    }
}
'@
$job = [CherryBackgroundJob]::Create()
if ($job -eq [IntPtr]::Zero) { exit 2 }
$runner = [int]$env:CHERRY_BG_JOB_RUNNER
if (-not [CherryBackgroundJob]::Assign($job, $runner)) { exit 3 }
$target = $env:CHERRY_BG_JOB_FILE
$request = $env:CHERRY_BG_JOB_REQUEST
$staging = $target + '.staging'
[System.IO.File]::WriteAllText($env:CHERRY_BG_JOB_READY, 'ready')
$answered = ''
$missed = 0
try {
  while ($true) {
    try {
      $members = [CherryBackgroundJob]::Pids($job)
      # A failed read proves nothing; a repeated absence does, since the runner is a member while
      # it lives. The keeper may not outlive it, and must not kill the task on one bad read.
      if ($null -eq $members) { Start-Sleep -Milliseconds 50; continue }
      if ($members -contains $runner) { $missed = 0 }
      else {
        $missed++
        if ($missed -ge 20) { break }
        Start-Sleep -Milliseconds 50
        continue
      }
      # The runner asks for the list once its own probe has been reaped, so a supervision process
      # it already released cannot be answered as the task's work.
      $nonce = ''
      try { $nonce = [System.IO.File]::ReadAllText($request) } catch {}
      if ($nonce -ne '' -and $nonce -ne $answered) {
        $answered = $nonce
        $parts = @()
        foreach ($member in $members) { $parts += [string]$member }
        [System.IO.File]::WriteAllText($staging, '{"nonce":"' + $nonce + '","pids":[' + ($parts -join ',') + ']}')
        [void][CherryBackgroundJob]::Publish($staging, $target)
      }
    } catch {
    }
    Start-Sleep -Milliseconds 50
  }
} finally {
  [void][CherryBackgroundJob]::CloseHandle($job)
}
exit 0
`

/**
 * Windows detach and log capture cannot share one shell hop: a `DETACHED_PROCESS` `cmd.exe`
 * never hands its stdio to the processes it starts, while an attached task dies with the app.
 * Running the command from a detached Node process keeps the shell ordinary, so both hold.
 * The command travels as `argv[1]` so a long one cannot overflow the Windows environment block.
 *
 * The runner is also this task's only Windows anchor: it is the process this app records, signals
 * through, and inventories, so it may not exit just because its shell did — a backgrounded job
 * (`start "" /b ping -t …`) outlives the shell that started it. Only once the process table shows
 * nothing left behind by the runner or the shell does the runner exit with the shell's own status.
 */
export const WINDOWS_DETACHED_TASK_RUNNER = `
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// This runner travels as a task-owned script file, not as an inline argument: the command alone
// may reach 10,000 characters, and the runner's own source on the same command line would push
// the launch past CreateProcessW's 32,767-character limit.
const command = process.argv[2]
const evidenceFile = process.argv[3]
// Durable membership the ancestry walk cannot give: the runner joins a Job Object before it
// starts the shell, so every process it creates stays a member for as long as it lives — a worker
// whose intermediate parent starts and exits between two samples included. The keeper holds the
// job's only handle and republishes its process list; KILL_ON_JOB_CLOSE ends the task's whole tree
// when that handle goes, so a stop that destroys the keeper kills what a walk could never name.
const jobFile = evidenceFile + '.job'
const jobReady = jobFile + '.ready'
const jobRequest = jobFile + '.request'
const jobScript = jobFile + '.ps1'
let keeper = null
let jobActive = false
let started = false
let jobNonce = 0
// A creation stamp is FILETIME ticks, never the CSV text form: "9:59:59" sorts after "10:00:00"
// there, which would read a replacement's later child as an earlier one.
const createdTicks = (created) => {
  const ticks = Number(created)
  return Number.isFinite(ticks) ? ticks : NaN
}
const createdBefore = (earlier, later) => createdTicks(earlier) < createdTicks(later)
const jobSleep = (ms) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (error) {}
}
// The membership is read on request, never from the last snapshot: the runner's own probes are job
// members too, and one this call has already reaped would otherwise still read as work.
const jobMembers = () => {
  const nonce = Date.now().toString(36) + '-' + ++jobNonce
  try {
    fs.writeFileSync(jobRequest + '.staging', nonce)
    fs.renameSync(jobRequest + '.staging', jobRequest)
  } catch (error) {
    return null
  }
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try {
      const answer = JSON.parse(fs.readFileSync(jobFile, 'utf8'))
      if (answer && answer.nonce === nonce && Array.isArray(answer.pids)) return answer.pids
    } catch (error) {}
    jobSleep(25)
  }
  return null
}
// A member the job still holds is work no walk may have seen: a walk reads a table, and a worker
// whose intermediate parent exited between samples has no row that names it.
const jobHoldsWork = (rows) => {
  if (!jobActive) return false
  const members = jobMembers()
  // No answer proves nothing either way, so it may never be what calls the task done.
  if (!members) return true
  // Everything this runner starts is its own supervision, not the task's work.
  const supervision = new Set()
  for (const row of rows) if (row.ppid === process.pid) supervision.add(row.pid)
  return members.some((member) => {
    const pid = Number(member)
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && !supervision.has(pid)
  })
}
const start = () => {
  if (started) return
  started = true
  const task = spawn(command, { shell: true, stdio: 'inherit', env })
  // The shell pid is the one member of the tree the app cannot rediscover once the shell has
  // exited — taskkill follows live parents only — so the app records it and seeds its own walk
  // with it, reaching the work the shell left behind across the dead link. The creation stamps
  // ride along: a pid is only a number, and one that has turned over reads a different stamp,
  // so a stop can refuse an occupant that is not the process this app spawned.
  const stamps = {}
  try {
    const identities = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "ProcessId=' +
          process.pid +
          ' or ProcessId=' +
          task.pid +
          '" | Select-Object ProcessId,@{n="CreationDate";e={[string]$_.CreationDate.ToUniversalTime().Ticks}} | ConvertTo-Csv -NoTypeInformation'
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    for (const row of String(identities).split('\\n')) {
      const fields = row.replace(/"/g, '').trim().split(',')
      if (fields.length !== 2 || !Number(fields[0]) || !fields[1]) continue
      if (Number(fields[0]) === process.pid) stamps.runnerCreatedAt = fields[1]
      else if (task.pid && Number(fields[0]) === task.pid) stamps.shellCreatedAt = fields[1]
    }
  } catch (error) {}
  // The evidence is read by the app while this runner keeps writing it, so every write lands
  // through a sibling and a rename: a torn read must never be what a stop walks from.
  const writeEvidence = (payload) => {
    try {
      const staging = evidenceFile + '.tmp'
      fs.writeFileSync(staging, JSON.stringify(payload))
      fs.renameSync(staging, evidenceFile)
    } catch (error) {}
  }
  writeEvidence({ shellPid: task.pid || 0, ...stamps })
  task.on('error', () => process.exit(1))
  // The ancestry probe runs from spawn, not from the shell's exit: an intermediate process can
  // fork a worker and exit before any post-exit poll, leaving the worker parented to a pid no
  // live row names. Only the settle rule waits for the shell.
  let exitStatus = 0
  let shellExited = false
  let emptyReadings = 0
  let timer = null
  // Members an earlier poll verified as the task's work, each under the creation stamp it was
  // seen with. A worker's death orphans the children it forked — their parent pid no longer
  // reaches any live row — so this memory is what keeps such a descendant counted after the
  // parent that would have vouched for it is gone.
  const known = new Map()
  const settle = () => {
    if (timer) clearInterval(timer)
    // These files are the task's own supervision and serve nothing once it is done: its last
    // moment is the only one that can take them away.
    for (const leftover of [process.argv[1], jobReady, jobRequest, jobRequest + '.staging', jobScript]) {
      try {
        fs.rmSync(leftover, { force: true })
      } catch (error) {}
    }
    process.exit(exitStatus)
  }
  const probe = () => {
    let table
    try {
      table = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{n="CreationDate";e={[string]$_.CreationDate.ToUniversalTime().Ticks}} | ConvertTo-Csv -NoTypeInformation'
        ],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )
    } catch (error) {
      // A probe that cannot run leaves no table to walk, but the job still holds the task's
      // membership: only its answer may settle the task once the shell is gone. While the shell
      // still runs, the anchor is its own.
      if (error.code === 'ENOENT' && shellExited && (!jobActive || !jobHoldsWork([]))) settle()
      return
    }
    const shellPid = Number(task.pid) || 0
    const rows = []
    for (const row of String(table).split('\\n')) {
      const fields = row.replace(/"/g, '').trim().split(',')
      const pid = Number(fields[0])
      if (fields.length !== 3 || !pid || !fields[2]) continue
      rows.push({ pid, ppid: Number(fields[1]), created: fields[2] })
    }
    const byPid = new Map(rows.map((row) => [row.pid, row]))
    const keep = new Set()
    // Read once per probe, and only when a dead link needs it. A row whose parent is gone may have
    // been forked by whoever the OS handed that freed number to, so the job — held since before the
    // parent existed — is the only membership that can still tie the row to the task.
    let jobMembership
    const jobAdmits = (pid) => {
      if (!jobActive) return false
      if (jobMembership === undefined) jobMembership = jobMembers()
      return jobMembership !== null && jobMembership.some((member) => Number(member) === pid)
    }
    for (const row of rows) {
      // This runner itself, and every row it parents except the shell, is the task's own
      // supervision — this very probe — not the task's work.
      if (row.pid === process.pid) continue
      if (row.ppid === process.pid && row.pid !== shellPid) continue
      // A member still reading the stamp it was verified under is still the work; the same pid
      // reading a different stamp is a reuse, refused like any stranger.
      if (known.get(row.pid) === row.created) {
        keep.add(row.pid)
        continue
      }
      // A pid this walk remembers is only a number, and one whose occupant now reads a stamp the
      // walk never recorded is a process the OS handed the freed number to. It is not this task's
      // work and may never be re-verified: re-admitting it would extend the task's ownership to
      // whatever that stranger has since forked, which is what a stop would then take down.
      if (known.has(row.pid)) continue
      // A row the shell left behind, or one whose parent an earlier poll verified, is work from
      // across a dead link. A child is always created after the parent it was created under, so a
      // live parent is what proves the row is that parent's own — and a row is refused when a live
      // replacement took the parent's pid after it appeared: such a replacement is stamped later
      // than the row, which is therefore not the replacement's child but this task's orphan. The
      // shell pid is not exempt, and a stamp that was never captured — a shell that exited before
      // the identity query — vouches for nothing: the occupant there is only an occupant, and the
      // rows it has forked since belong to whoever the OS gave that number to.
      if (row.pid !== shellPid && (row.ppid === shellPid || known.has(row.ppid))) {
        const parent = byPid.get(row.ppid)
        // Nothing in the table names the parent any more, so a matching number is the only link —
        // and a reused number forks strangers. Only durable job membership may cross that link.
        if (!parent) {
          if (jobAdmits(row.pid)) keep.add(row.pid)
        } else if (row.ppid === shellPid) {
          if (parent.created === stamps.shellCreatedAt || createdBefore(row.created, parent.created)) keep.add(row.pid)
        } else if (known.get(row.ppid) === parent.created || createdBefore(row.created, parent.created)) keep.add(row.pid)
      }
    }
    let grew = true
    while (grew) {
      grew = false
      for (const row of rows) {
        if (keep.has(row.pid) || row.pid === process.pid) continue
        if (row.ppid === process.pid && row.pid !== shellPid) continue
        // A remembered pid whose occupant now reads a different stamp is a stranger, so it may
        // not be adopted here either — this loop extends ownership, it never re-establishes it.
        if (known.has(row.pid)) continue
        // A member is only extended through a parent that is still the process this walk
        // verified: a pid whose occupant now reads a different stamp is a stranger, and its
        // descendants belong to whatever the OS handed that pid to.
        const parent = byPid.get(row.ppid)
        if (keep.has(row.ppid) && (!parent || known.get(row.ppid) === parent.created)) {
          keep.add(row.pid)
          grew = true
        }
      }
    }
    for (const row of rows) {
      if (keep.has(row.pid)) known.set(row.pid, row.created)
    }
    // The ancestry memory rides in the evidence file: a kill destroys this runner together with
    // it, and the stamps recorded here are what keep its observations attributable afterwards.
    writeEvidence({
      shellPid: task.pid || 0,
      ...stamps,
      known: Array.from(known, ([pid, created]) => ({ pid, created }))
    })
    // A job the shell just backgrounded can surface a beat late, so the tree must read empty
    // twice before the anchor may leave. The shell's own life is not evidence of work.
    if (!shellExited) return
    if (keep.size > 0) {
      emptyReadings = 0
      return
    }
    // An empty walk is not proof on its own: the intermediate that forked a survivor may never
    // have been sampled, so no row names the survivor. The job holds that membership from before
    // the shell existed: an empty answer is the certificate, and without one the walk must read
    // empty twice.
    if (jobHoldsWork(rows)) {
      emptyReadings = 0
      return
    }
    if (jobActive) settle()
    if (++emptyReadings < 2) return
    settle()
  }
  task.on('exit', (code, signal) => {
    exitStatus = signal ? 1 : (code == null ? 1 : code)
    shellExited = true
    probe()
  })
  probe()
  timer = setInterval(probe, 500)
}
const refuse = () => {
  if (started) return
  started = true
  process.exit(1)
}
const boot = () => {
  // Only a file can be executed, and the keeper must exist before anything is started, so the
  // runner writes it itself rather than depending on a caller that may have failed to.
  try {
    fs.writeFileSync(jobScript, ${JSON.stringify(WINDOWS_DETACHED_TASK_JOB_KEEPER)})
  } catch (error) {
    refuse()
    return
  }
  try {
    keeper = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', jobScript],
      {
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...env,
          CHERRY_BG_JOB_RUNNER: String(process.pid),
          CHERRY_BG_JOB_READY: jobReady,
          CHERRY_BG_JOB_REQUEST: jobRequest,
          CHERRY_BG_JOB_FILE: jobFile
        }
      }
    )
  } catch (error) {
    keeper = null
    refuse()
    return
  }
  keeper.on('error', () => {
    keeper = null
    // No PowerShell means no job and no process table: a command started here could never be
    // certified done, so the runner refuses to start one.
    refuse()
  })
  // The keeper's exit closes the job, and KILL_ON_JOB_CLOSE takes the members with it: from then
  // on there is no durable membership left to consult.
  keeper.on('exit', () => {
    const established = jobActive
    keeper = null
    jobActive = false
    // A keeper that exits without holding the job — Add-Type blocked, the assignment refused —
    // would leave a task whose completion nothing can ever certify. Refuse before any work is
    // created rather than start something that may be published as done while it still runs.
    if (!established && !started) refuse()
  })
  keeper.unref()
  // The runner must be a member before the shell is created — membership is inherited at creation
  // and never retroactively — so the command waits for the keeper to report the job held. The first
  // PowerShell on a machine compiles the keeper type, and anti-malware can make that cold start
  // slow; the wait is bounded, not short.
  const deadline = Date.now() + 25000
  const waitForJob = () => {
    if (started) return
    // A failed spawn or an exited keeper is decided by its own handler: starting here would strip
    // the job from a runner that could still have one.
    if (!keeper) return
    if (fs.existsSync(jobReady)) {
      jobActive = true
      start()
      return
    }
    if (Date.now() >= deadline) {
      refuse()
      return
    }
    setTimeout(waitForJob, 50)
  }
  waitForJob()
}
boot()
`

/**
 * POSIX keeps the task's identity in one long-lived anchor. The command runs in a shell that is a
 * child of this supervisor, so the supervisor is the session and group leader, and it exits only
 * once the group holds no other live member. A process joins a group by inheriting it from a parent
 * already in it — `setpgid` across sessions is refused — so a live anchor holds every member of the
 * group to the task's own descent, including a worker forked by another worker that has since
 * exited, which no parent-chain walk can reach. Once the anchor exits the group is empty, so its
 * number is free for the OS to reuse with nothing of the task's left to adopt.
 *
 * The stop signals are deliberately ignored: they are addressed to the work, and an anchor that
 * abandoned the group on SIGTERM would strand the very members it exists to vouch for.
 */
export const POSIX_DETACHED_TASK_SUPERVISOR = `
const { spawn, execFileSync } = require('node:child_process')
const self = process.pid
const pgid = self
// The app ran this process with ELECTRON_RUN_AS_NODE=1 to get a Node here, and that flag is for
// this process alone: left in the environment it would turn any Electron binary the command
// launches into a plain Node too.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
for (const ignored of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  try { process.on(ignored, () => {}) } catch (error) {}
}
const task = spawn(process.argv[1], { shell: true, stdio: 'inherit', env })
task.on('error', () => process.exit(1))
task.on('exit', (code, signal) => {
  const status = signal ? 1 : (code == null ? 1 : code)
  // Deliberately not unref'd: this process has nothing else to do, and an unref'd timer would let
  // it exit on the spot — before the first poll — with the group still holding live members.
  const poll = setInterval(() => {
    let live = 0
    try {
      const table = execFileSync('ps', ['-axwwo', 'pgid=,pid=,ppid=,state='], { encoding: 'utf8', timeout: 5000 })
      for (const row of table.split('\\n')) {
        const fields = row.trim().split(/\\s+/)
        if (fields.length < 4) continue
        if (Number(fields[0]) !== pgid) continue
        // This process and its own children — the command's shell and this very probe — are the
        // anchor's, not the work's. Counting them would keep the anchor alive forever.
        if (Number(fields[1]) === self || Number(fields[2]) === self) continue
        if (!fields[3] || fields[3].startsWith('Z')) continue
        live++
      }
    } catch (error) {
      return
    }
    if (live === 0) {
      clearInterval(poll)
      process.exit(status)
    }
  }, 250)
})
`

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
  stderrFd: number,
  evidenceFile: string
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
      // The runner is a task-owned script file, not an `-e` argument: the command may use its whole
      // 10,000-character budget, and the runner's source on the same command line would exceed
      // what CreateProcessW accepts. It records the shell pid in `evidenceFile` at spawn — the root
      // a stop walk seeds from once the shell has exited and taskkill can no longer cross it.
      args: [`${evidenceFile}.runner.js`, command, evidenceFile],
      options: { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    }
  }
  // The supervisor is the session leader, so the pid this app records is its own and the group it
  // leads holds the command and everything the command forks. `process.execPath` is the Electron
  // binary in the packaged app, so it only behaves as Node under ELECTRON_RUN_AS_NODE — and the
  // supervisor strips that flag again before running the command, since it names this process only.
  return {
    file: process.execPath,
    args: ['-e', POSIX_DETACHED_TASK_SUPERVISOR, command],
    options: { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  }
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
  const evidenceFile = path.join(input.storageDir, `${id}${BACKGROUND_TASK_EVIDENCE_EXT}`)
  const startedAt = new Date().toISOString()

  // The detached runner is a file rather than an `-e` argument so a command may use its whole
  // length budget without pushing the launch past CreateProcessW's limit.
  if (process.platform === 'win32') {
    await writeFile(`${evidenceFile}.runner.js`, WINDOWS_DETACHED_TASK_RUNNER, { mode: 0o600 })
  }
  const logHandle = await open(logFile, 'a', 0o600)
  try {
    const target = buildDetachedBackgroundTaskSpawn(command, input.cwd, logHandle.fd, logHandle.fd, evidenceFile)
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
      ownedTaskGroups.set(id, { pgid: record.pid, members, leaderReaped: false })
      // The stamp lookup is a one-shot call that can time out, and its result is the seed every
      // member is verified from: without one the task can never be owned, so Stop/Kill stays
      // refused while it runs, restart has no identity, and a purge cannot discover it. Recover it
      // here, while the leader has just been spawned and provably leads the group it names.
      if (!record.pidStartTime && process.platform !== 'win32') {
        const owned = ownedTaskGroups.get(id)!
        const live = readGroupMembers(record.pid)
        if (live && adoptGroupLeader(owned, live)) {
          record.pidStartTime = owned.members.get(record.pid)
        }
      }
    }

    // A spawn failure can emit both 'error' and 'close'; finalize guards so
    // at most one completion lands. Handlers go
    // on before any await — both events can fire on the first ticks.
    // Taking stock on a pulse while the group works: a member is only the task's while this app can
    // still tie it to one it has verified, and that tie is easiest to establish while its parent
    // lives. The Windows kill targets the pid tree instead, so there is nothing to verify there.
    const taking =
      process.platform === 'win32'
        ? undefined
        : setInterval(() => trackVerifiedMembers(id, input.storageDir), LEADERLESS_GROUP_POLL_MS)
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
      // A plain Windows exit is supervised by the runner itself — it leaves only once its own
      // probe read the tree empty. A stop that killed the runner enjoys no such guarantee: work
      // it never reached may still be listed, so its record must stay unresolved — running,
      // owned, unpublishing nothing — until the recorded evidence proves the tree empty.
      if (process.platform === 'win32' && record.pid > 0 && (await hasStopRequest(input.storageDir, id))) {
        if (!(await verifyWindowsTaskTerminated(input.storageDir, record))) {
          const poll = setTimeout(() => void settleThroughGroupDrain(), LEADERLESS_GROUP_POLL_MS)
          poll.unref?.()
          return
        }
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
      // The close/error event fires from this app's own reap of the leader, so the pid is free from
      // here on even though the group may still be draining and the entry is still needed.
      const owned = ownedTaskGroups.get(id)
      if (owned) owned.leaderReaped = true
      void settleThroughGroupDrain()
    }
    child.on('error', (error) => {
      logger.warn('Detached background task failed to spawn', { taskId: id, error })
      finalize('failed', null, null)
    })
    // 'close' rather than 'exit': it waits for the task's stdio to drain, so the final log
    // bytes are readable by the time completion is published. The supervisor holds the group until
    // it is empty, so this fires only once nothing of the task's is left — and a worker forked
    // between two pulses was still inside the group the supervisor vouched for while it lived.
    child.on('close', (code, signal) => {
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
          // Ownership returns before any replay, but only the supervisor's own stamp seeds it: a
          // worker that survived the cleanup kill is verified through the supervisor while it
          // lives, never adopted from its presence in the group.
          const members = new Map<number, string>()
          if (record.pidStartTime) members.set(record.pid, record.pidStartTime)
          ownedTaskGroups.set(id, { pgid: record.pid, members, leaderReaped: false })
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
 * The leader stamp the spawn could not capture but ownership has recovered since. A stop can be the
 * first call to read the table successfully, and its seed would otherwise stay in memory: a task
 * that ignores SIGTERM then keeps a running record with no identity on disk, so a restart cannot
 * re-identify the leader and Stop/Kill and the permanent purge both refuse it.
 */
function recoveredLeaderStamp(taskId: string): string | undefined {
  const owned = ownedTaskGroups.get(taskId)
  return owned?.members.get(owned.pgid)
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
  // Read after the identity check above, which can be the call that seeds the ownership the spawn
  // could not: this write is the record's only identity after a restart. Already under the lock.
  const pidStartTime = record.pidStartTime ?? recoveredLeaderStamp(record.id)
  const requested = {
    ...record,
    pidStartTime,
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
  // The runner is `.pids`' only writer, and it writes after an identity query that can spend its
  // whole five-second timeout — a kill landing first destroys the file and every later walk with
  // it. The stop waits out that window; a runner that died waiting proves no evidence is coming
  // (the verifier's recovery takes over), but a live one that never wrote is refused.
  if (process.platform === 'win32' && !(await waitForTaskEvidence(storageDir, record)) && isPidAlive(record.pid)) {
    logger.warn('Refusing to kill before the runner has recorded its identity evidence', {
      taskId: record.id,
      pid: record.pid
    })
    await writeRecord(storageDir, record)
    return undefined
  }
  // The recorded runner pid is a number the OS may have handed to someone else since the spawn —
  // a crash or an earlier kill frees it. Its creation stamp is the one the runner captured while
  // it was provably ours, so a live occupant reading a different stamp is a stranger and the kill
  // is refused: the record stays running, unresolved, and stoppable once it can be accounted for.
  if (process.platform === 'win32' && !(await isWindowsRunnerVerified(storageDir, record))) {
    logger.warn('Refusing to kill a recorded pid whose occupant is not the spawned runner', {
      taskId: record.id,
      pid: record.pid
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
  // On Windows the kill is only as good as taskkill's live-parent walk, which cannot reach a
  // worker past the shell that spawned it. Until the table proves nothing of the task is left,
  // the record stays `running` and stop-requested: stoppable again, refusing the purge, and
  // honest about work that may still be going on.
  if (process.platform === 'win32' && !(await verifyWindowsTaskTerminated(storageDir, record))) {
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

/**
 * `lstart` right-pads the day to two columns (`Mon Oct  5 …`), and the group table is parsed
 * field-wise, which collapses that padding. Both readings must name the instant the same way or a
 * task started on the 1st–9th stops matching itself.
 */
function normalizeLstart(lstart: string): string {
  return lstart.trim().replace(/\s+/g, ' ')
}

function getPidStartTime(pid: number): string | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const raw = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1_000 })
    return normalizeLstart(raw) || undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the process group still holds a member the OS schedules other than the supervisor this
 * app spawned — the anchor outlives its command on purpose, so it is never the work. A group kill
 * answers EPERM both when every member has exited unreaped and when every live member fails the
 * credential check (a setuid `sudo` the task exec'd), so the exit is only proven once nothing but
 * the anchor is left. An unreadable table is not an empty group: nothing about the task has been
 * established.
 */
function groupIsEmpty(pgid: number): boolean {
  const members = readGroupMembers(pgid)
  return members !== null && members.every((member) => member.pid === pgid)
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
      members.push({
        pid: Number(fields[1]),
        ppid: Number(fields[2]),
        lstart: normalizeLstart(fields.slice(-5).join(' '))
      })
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
/**
 * Whether the record's process evidence may still describe live work. A dead leader whose group
 * reads back empty is a confirmed exit — the app simply was not running to write its sentinel —
 * while a group still holding members, or a table that cannot be read at all, leaves it open.
 */
/**
 * Whether a reconciled record still has evidence of live work, read the way its platform records
 * identity: POSIX verifies the start stamp and the group, Windows verifies the runner's creation
 * evidence — a confirmed replacement is not live work, while an unverifiable one stays conservative.
 */
export async function hasLiveTaskEvidence(storageDir: string, record: BackgroundTaskRecord): Promise<boolean> {
  if (record.pid <= 0) return false
  if (process.platform !== 'win32') return hasLiveGroupEvidence(record)
  if (!isPidAlive(record.pid)) return false
  return !(await hasReplacedWindowsRunner(storageDir, record, readWindowsProcessTable))
}

export function hasLiveGroupEvidence(record: BackgroundTaskRecord): boolean {
  if (record.pid <= 0) return false
  // A live pid is only this task's work while its recorded start stamp matches: a task that
  // finished while the app was closed leaves its pid free for an unrelated occupant. Group
  // members stay conservative — unreadable or unattributed evidence still counts as live.
  if (isPidAlive(record.pid) && !isRecycledPid(record)) return true
  if (process.platform === 'win32') return false
  return groupHasLiveMember(record.pid)
}

export function hasUnownedLiveGroup(record: BackgroundTaskRecord): boolean {
  if (process.platform === 'win32' || record.pid <= 0) return false
  if (ownedTaskGroups.get(record.id)?.pgid === record.pid) return false
  return groupHasLiveMember(record.pid)
}

/**
 * Bounded wait for the group's last member to disappear. Group-signal delivery is per member:
 * a survivor failing the credential check keeps the group alive after a successful kill, so
 * only an empty group proves the task has ended. One empty reading is not enough — a worker the
 * command's shell backgrounded takes a moment to appear in the table — so the group has to read
 * empty twice in a row before it counts as drained.
 */
async function waitForGroupDrain(pgid: number): Promise<boolean> {
  const deadline = Date.now() + STOP_DRAIN_TIMEOUT_MS
  let emptyReadings = 0
  while (emptyReadings < 2) {
    if (groupHasLiveMember(pgid)) emptyReadings = 0
    else emptyReadings++
    if (Date.now() >= deadline) return false
    if (emptyReadings < 2) await new Promise((resolve) => setTimeout(resolve, STOP_DRAIN_POLL_MS))
  }
  return true
}

/** A live row of the Windows process table: a pid, the parent it was created under, and when. */
interface WindowsProcessRow {
  pid: number
  ppid: number
  created: string
}

/**
 * A recorded root of the kill walk — the runner or the shell — with the creation stamp it was
 * captured under while it was provably this task's. A live occupant reading a different stamp is
 * a pid the OS has since handed to someone else.
 */
interface WindowsTaskRoot {
  pid: number
  created?: string
}

/** The identity evidence the runner wrote at spawn, read back by the stop and purge paths. */
interface WindowsTaskEvidence {
  shellPid: number
  runnerCreatedAt?: string
  shellCreatedAt?: string
  /** Descendants the runner verified while it lived, each under the stamp it was seen with. */
  known?: WindowsTaskRoot[]
}

/**
 * The Windows process table, read through the same probe the runner uses. Awaited rather than
 * run inline so one slow read cannot block the main process behind every other task. `null`
 * when it cannot be read, which is never evidence of anything.
 */
async function readWindowsProcessTable(): Promise<WindowsProcessRow[] | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{n="CreationDate";e={[string]$_.CreationDate.ToUniversalTime().Ticks}} | ConvertTo-Csv -NoTypeInformation'
        ],
        { timeout: 5_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(String(stdout))
        }
      )
    })
    const rows: WindowsProcessRow[] = []
    for (const row of String(stdout).split('\n')) {
      const fields = row.replace(/"/g, '').trim().split(',')
      if (fields.length !== 3) continue
      const pid = Number(fields[0])
      const ppid = Number(fields[1])
      if (!pid || !ppid || !fields[2]) continue
      rows.push({ pid, ppid, created: fields[2] })
    }
    return rows
  } catch {
    return null
  }
}

/**
 * The live processes that still belong to the task, found from the pid roots this app recorded —
 * the runner and the shell that may have exited before its work. A row names its parent even
 * after that parent has exited, so this walk crosses the dead link that `taskkill /T`, which
 * follows live parents only, cannot. A recorded pid is only a number, so a root is verified only
 * under the creation stamp it was captured with: a live occupant reading a different stamp — or
 * a root this app holds no stamp for — is a stranger, refused outright together with everything
 * it has since forked; the rows it parents count as this task's orphans only when they were
 * created before the replacement took over.
 */
/**
 * A creation stamp as a chronology. The identity queries project `CreationDate` as FILETIME ticks
 * because the CSV form is culture text, whose lexical order is not chronological: `9:59:59` sorts
 * after `10:00:00` there. Anything that is not ticks has no chronology at all.
 */
function createdTicks(created: string): number | undefined {
  const ticks = Number(created)
  return Number.isFinite(ticks) ? ticks : undefined
}

/** Whether `earlier` provably predates `later`; two unparseable stamps prove nothing. */
function createdBefore(earlier: string, later: string): boolean {
  const from = createdTicks(earlier)
  const to = createdTicks(later)
  return from !== undefined && to !== undefined && from < to
}

function collectTaskProcessPids(rows: WindowsProcessRow[], roots: WindowsTaskRoot[]): Set<number> {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const rootPids = new Set(roots.map((root) => root.pid))
  const verified = new Set<number>()
  for (const root of roots) {
    const row = byPid.get(root.pid)
    // No stamp, no verification: a live occupant on a root nothing ties to the original process
    // is a stranger the sweep must spare, however plausible the bare pid looks.
    if (row && row.created === root.created) verified.add(row.pid)
  }
  const work = new Set<number>()
  for (const row of rows) {
    if (verified.has(row.pid) || !rootPids.has(row.ppid)) continue
    const occupant = byPid.get(row.ppid)
    // With the parent absent from the snapshot only its number links the row to the task, and the
    // OS may have reused that number for an unrelated parent that forked this row and exited. Such
    // a row is adopted only when it is itself a root the runner verified under its stamp (already
    // collected above), never on the strength of the parent's number alone.
    if (!occupant) continue
    if (!verified.has(occupant.pid) && !createdBefore(row.created, occupant.created)) continue
    work.add(row.pid)
  }
  for (let grew = true; grew;) {
    grew = false
    for (const row of rows) {
      if (verified.has(row.pid) || work.has(row.pid)) continue
      if (work.has(row.ppid) || verified.has(row.ppid)) {
        work.add(row.pid)
        grew = true
      }
    }
  }
  for (const pid of verified) work.add(pid)
  return work
}

/**
 * Whether a live row sits on a recorded root this app holds no stamp for. Such an occupant is no
 * kill target — nothing ties it to the task — but its presence is not excludable either, so it
 * holds the task's termination unproven until identity for that root exists.
 */
function hasUnidentifiedRootOccupant(rows: WindowsProcessRow[], roots: WindowsTaskRoot[]): boolean {
  return roots.some((root) => !root.created && rows.some((row) => row.pid === root.pid))
}

/**
 * The identity evidence the runner recorded at spawn: the shell pid, plus the creation stamps
 * captured while the runner and the shell were provably this task's. Absent — an older record,
 * or a failed write or identity query — a stamp establishes nothing and the walk degrades to
 * the recorded pids alone.
 */
async function readTaskEvidence(storageDir: string, taskId: string): Promise<WindowsTaskEvidence | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(storageDir, `${taskId}${BACKGROUND_TASK_EVIDENCE_EXT}`), 'utf8')
    ) as { shellPid?: number; runnerCreatedAt?: string; shellCreatedAt?: string; known?: unknown }
    const pid = Number(parsed.shellPid)
    if (!Number.isInteger(pid) || pid <= 0) return undefined
    return {
      shellPid: pid,
      ...(typeof parsed.runnerCreatedAt === 'string' && parsed.runnerCreatedAt
        ? { runnerCreatedAt: parsed.runnerCreatedAt }
        : {}),
      ...(typeof parsed.shellCreatedAt === 'string' && parsed.shellCreatedAt
        ? { shellCreatedAt: parsed.shellCreatedAt }
        : {}),
      ...readKnownEntries(parsed.known)
    }
  } catch {
    return undefined
  }
}

/**
 * The descendants the runner verified while it lived, read back from the evidence. Only entries
 * carrying both a pid and the stamp it was seen under are identity — a bare number authorizes
 * nothing.
 */
function readKnownEntries(known: unknown): { known: WindowsTaskRoot[] } | {} {
  if (!Array.isArray(known)) return {}
  const entries: WindowsTaskRoot[] = []
  for (const entry of known as Array<{ pid?: unknown; created?: unknown }>) {
    const pid = Number(entry?.pid)
    const created = entry?.created
    if (Number.isInteger(pid) && pid > 0 && typeof created === 'string' && created) {
      entries.push({ pid, created })
    }
  }
  return entries.length > 0 ? { known: entries } : {}
}

/**
 * Waits out the runner's evidence write. The runner is `.pids`' only writer, and it writes after
 * an identity query that can spend its whole five-second timeout — a stop that arrived first
 * would destroy the file and every later walk with it. `undefined` means the window closed
 * without a write: either the runner is gone, so nothing will ever be written, or it is wedged
 * on the one thing it must do before it may be signalled.
 */
async function waitForTaskEvidence(
  storageDir: string,
  record: BackgroundTaskRecord
): Promise<WindowsTaskEvidence | undefined> {
  const deadline = Date.now() + TASK_EVIDENCE_WAIT_TIMEOUT_MS
  for (;;) {
    const evidence = await readTaskEvidence(storageDir, record.id)
    if (evidence) return evidence
    if (!isPidAlive(record.pid)) return undefined
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, TASK_EVIDENCE_WAIT_POLL_MS))
  }
}

/**
 * Whether the recorded runner pid may be signalled. A dead number has nothing to signal, and the
 * walk below still reaches the shell's side of the tree. A live occupant is only the process this
 * app spawned while it reads the stamp captured at spawn; without that stamp — the identity query
 * failed — nothing ties the occupant to the task, so it is refused and the record stays unresolved
 * rather than killing whatever the OS has since put at that number.
 */
async function isWindowsRunnerVerified(storageDir: string, record: BackgroundTaskRecord): Promise<boolean> {
  if (!isPidAlive(record.pid)) return true
  const evidence = await readTaskEvidence(storageDir, record.id)
  const rows = await readWindowsProcessTable()
  if (!rows) return false
  const row = rows.find((candidate) => candidate.pid === record.pid)
  if (!row) return true
  return evidence?.runnerCreatedAt !== undefined && row.created === evidence.runnerCreatedAt
}

/**
 * Whether the Windows kill is proven complete. `taskkill /T` cannot reach a worker past a shell
 * that has already exited — the worker survives it behind the dead link — so survivors are
 * looked up through the recorded roots and killed directly, and only a table reading with
 * nothing of the task's left may call the task stopped.
 */
async function verifyWindowsTaskTerminated(storageDir: string, record: BackgroundTaskRecord): Promise<boolean> {
  const evidence = await readTaskEvidence(storageDir, record.id)
  // The runner is the evidence's only writer. Dead before it ever wrote one — a startup that
  // failed inside its identity query — there is no root left to walk and no later read that can
  // differ, so holding the record open would strand it past every control path: the runner's own
  // absence is the termination proof.
  if (!evidence) return !isPidAlive(record.pid)
  // The descendants the runner verified while it lived ride in the evidence: a kill destroys the
  // runner and its ancestry memory together, and these stamps are what keep its observations
  // attributable — and killable — after it is gone.
  const roots: WindowsTaskRoot[] = [
    { pid: record.pid, created: evidence.runnerCreatedAt },
    { pid: evidence.shellPid, created: evidence.shellCreatedAt },
    ...(evidence.known ?? [])
  ]
  const deadline = Date.now() + STOP_DRAIN_TIMEOUT_MS
  for (;;) {
    const rows = await readWindowsProcessTable()
    if (rows) {
      const closure = collectTaskProcessPids(rows, roots)
      const survivors = rows.filter((row) => closure.has(row.pid))
      if (survivors.length === 0 && !hasUnidentifiedRootOccupant(rows, roots)) return true
      for (const survivor of survivors) {
        await execTaskkill(['/PID', String(survivor.pid), '/F']).catch(() => undefined)
      }
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, STOP_DRAIN_POLL_MS))
  }
}

/**
 * Whether the task's record carries a stop request. The runner's close event may fire while a
 * kill is in flight, and the spawn closure only holds the record as it was at start — the disk
 * is where the request shows.
 */
async function hasStopRequest(storageDir: string, taskId: string): Promise<boolean> {
  try {
    const current = await readRecord(storageDir, `${taskId}${BACKGROUND_TASK_RECORD_EXT}`)
    return current?.stopRequestedAt !== undefined
  } catch {
    return true
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
  let table: Promise<WindowsProcessRow[] | null> | undefined
  const readTable: TableReader = () => (table ??= readWindowsProcessTable())
  return (
    await Promise.all(
      records
        .filter((record): record is BackgroundTaskRecord => record !== undefined)
        .map((record) => reconcileDetachedBackgroundTask(storageDir, record, readTable))
    )
  ).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

/**
 * Whether the live process at the record's pid is demonstrably not the runner this task started.
 * Windows records no start stamp, so the runner's own creation evidence is its identity: a live
 * occupant reading a different stamp is a replacement. Without that evidence nothing is proven,
 * and the record keeps its conservative reading.
 */
async function hasReplacedWindowsRunner(
  storageDir: string,
  record: BackgroundTaskRecord,
  readTable: TableReader
): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const evidence = await readTaskEvidence(storageDir, record.id)
  if (!evidence?.runnerCreatedAt) return false
  const rows = await readTable()
  if (!rows) return false
  const row = rows.find((candidate) => candidate.pid === record.pid)
  return row !== undefined && row.created !== evidence.runnerCreatedAt
}

/** Reads the Windows process table; a listing shares one read across every record it reconciles. */
type TableReader = () => Promise<WindowsProcessRow[] | null>

async function reconcileDetachedBackgroundTask(
  storageDir: string,
  record: BackgroundTaskRecord,
  readTable: TableReader = readWindowsProcessTable
): Promise<BackgroundTaskRecord> {
  if (record.status !== 'running') return record
  const completion = await readSentinel(storageDir, record.id)
  if (completion) {
    return { ...record, ...completion, status: completion.status }
  }
  if (record.pid > 0 && isPidAlive(record.pid)) {
    const recycled = isRecycledPid(record) || (await hasReplacedWindowsRunner(storageDir, record, readTable))
    return recycled ? { ...record, status: 'unknown', note: t('background_task.note.gone_no_marker') } : record
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
  // A Windows kill whose termination could not be verified left the record running on purpose:
  // taskkill's live-parent walk cannot reach a worker past its dead shell, so reading `stopped`
  // here would strip the survivor's last tracking while its work goes on. The record stays as
  // the stop left it — stop-requested, and stoppable once its survivor can be accounted for.
  if (process.platform === 'win32' && record.stopRequestedAt) {
    return record
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
      let current: BackgroundTaskRecord | undefined
      try {
        current = await readRecord(storageDir, `${record.id}${BACKGROUND_TASK_RECORD_EXT}`)
      } catch {
        // Present but unreadable: the task did finish, so its completion is persisted either way,
        // and the access() check below still separates a purged record from a corrupt one.
        current = undefined
      }
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

/**
 * Only a confirmed absence yields `undefined`: any other read failure propagates, because a record
 * that exists but cannot be read may still describe live work, and callers that decide whether work
 * can be destroyed must not treat it as "no record".
 */
async function readRecord(storageDir: string, entry: string): Promise<BackgroundTaskRecord | undefined> {
  try {
    return JSON.parse(await readFile(path.join(storageDir, entry), 'utf8')) as BackgroundTaskRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Failed to read background task record ${entry}`, { cause: error })
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
