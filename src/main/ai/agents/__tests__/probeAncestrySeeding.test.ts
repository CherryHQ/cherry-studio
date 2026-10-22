import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WINDOWS_DETACHED_TASK_RUNNER } from '../backgroundTasks'

const TABLE_HEADER = '"ProcessId","ParentProcessId","CreationDate"'
/** Realistic creation order: the runner, then its shell, then the shell's child, then its child. */
const T_RUNNER = '639281447000000000'
const T_SHELL = '639281447100000000'
const T_MID = '639281447200000000'
const T_WORKER = '639281447300000000'
/**
 * A pid taken over after its first occupant exited is stamped later than anything it forks. These
 * two are the real `09:59:59`/`10:00:00` pair as PowerShell reports it: in the identity query's
 * culture text the later child sorts first, so only ticks can order them.
 */
const T_REUSED = '639281447990000000' // 2026-10-21 09:59:59 local
/** The stranger's own child, forked after it took the pid over. */
const T_REUSED_CHILD = '639281448000000000' // 2026-10-21 10:00:00 local

/**
 * A fake-table probe standing in for `powershell.exe`, placed on the runner's PATH. The spawn-time
 * identity query answers with the runner's own stamp and the shell's — both stamped in the order a
 * real table shows — and every other query prints the table the test writes.
 */

const SHIM = `#!/bin/sh
case "$*" in
*-Filter*)
  printf '"ProcessId","CreationDate"\\n'
  printf '"%s","${T_RUNNER}"\\n' "$PPID"
  shell_pid=$(printf '%s' "$*" | sed -n "s/.*ProcessId=[0-9][0-9]* or ProcessId=\\([0-9][0-9]*\\).*/\\1/p")
  if [ -n "$shell_pid" ]; then printf '"%s","${T_SHELL}"\\n' "$shell_pid"; fi
  ;;
*-File*)
  # The job keeper: membership is what the runner may cross a dead parent link through, so the
  # test decides which simulated processes the OS recorded when it created them.
  printf 'ready' > "$CHERRY_BG_JOB_READY"
  last=""
  while kill -0 "$CHERRY_BG_JOB_RUNNER" 2>/dev/null; do
    if [ -f "$CHERRY_BG_JOB_REQUEST" ]; then
      nonce=$(cat "$CHERRY_BG_JOB_REQUEST" 2>/dev/null)
      if [ -n "$nonce" ] && [ "$nonce" != "$last" ]; then
        last="$nonce"
        members=$(cat "$BG_FAKE_MEMBERS" 2>/dev/null)
        printf '{"nonce":"%s","pids":%s}' "$nonce" "\${members:-[]}" > "$CHERRY_BG_JOB_FILE.staging" &&
          mv "$CHERRY_BG_JOB_FILE.staging" "$CHERRY_BG_JOB_FILE" 2>/dev/null
      fi
    fi
    sleep 0.05
  done
  ;;
*) cat "$BG_FAKE_TABLE" ;;
esac
exit 0`

/** One row of the simulated Windows process table, resolved once the shell pid is known. */
type ProbeRow = [pid: number, parent: number | 'shell', created: string]

describe.skipIf(process.platform === 'win32')('the runner seeds ancestry from live parents', () => {
  let dir: string
  /** Probe runners still anchoring when the test ended; they write evidence on a cadence. */
  let liveProbes: Array<ReturnType<typeof spawn>> = []

  /**
   * Runs the exported runner as its own process against a simulated Windows process table.
   *
   * The table is complete and its creation order is real: the runner is stamped first, then the
   * shell it spawned, then the intermediate the shell spawned, then the worker the intermediate
   * spawned — a child is never stamped before the parent it was created under, which is what a
   * real table always shows. The shell stays in the table for `shellLifetimeMs`, so the
   * intermediate can exit while the shell is still alive and leave its worker parented to a pid
   * no live row names.
   */
  const runProbe = async (
    plan: Array<{ afterMs: number; rows: ProbeRow[] }>,
    opts: { shellLifetimeMs: number; waitMs: number; members?: string }
  ): Promise<{ known: number[]; exitCode: number | null }> => {
    const tableFile = path.join(dir, 'table.csv')
    const evidence = path.join(dir, 'bt-probe.pids')
    const membersFile = path.join(dir, 'members.json')
    const shimDir = path.join(dir, 'shim')
    await writeFile(tableFile, TABLE_HEADER)
    await writeFile(membersFile, opts.members ?? '[]')
    await mkdir(shimDir, { recursive: true })
    const shim = path.join(shimDir, 'powershell.exe')
    await writeFile(shim, `${SHIM}\n`)
    await chmod(shim, 0o755)

    const command = `"${process.execPath}" -e "setTimeout(() => {}, ${opts.shellLifetimeMs})"`
    // The runner is a task-owned file now: `node <file> <command> <evidence>`.
    const runnerFile = path.join(dir, 'runner.js')
    await writeFile(runnerFile, WINDOWS_DETACHED_TASK_RUNNER)
    const child = spawn(process.execPath, [runnerFile, command, evidence], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
        BG_FAKE_TABLE: tableFile,
        BG_FAKE_MEMBERS: membersFile
      },
      stdio: ['ignore', 'ignore', 'ignore']
    })
    liveProbes.push(child)

    let shellPid = 0
    await vi.waitFor(
      async () => {
        shellPid = Number(JSON.parse(await readFile(evidence, 'utf8')).shellPid)
        expect(shellPid).toBeGreaterThan(0)
      },
      { timeout: 10_000, interval: 25 }
    )
    // The runner and its shell are always in the table, stamped in the order they were created:
    // a table without the live shell is not the state an unexited shell produces, and a worker
    // reaches the task only through a parent the table still names.
    const render = (rows: ProbeRow[]) =>
      `${[
        TABLE_HEADER,
        `"${child.pid}","4","${T_RUNNER}"`,
        `"${shellPid}","${child.pid}","${T_SHELL}"`,
        ...rows.map(([pid, parent, created]) => `"${pid}","${parent === 'shell' ? shellPid : parent}","${created}"`)
      ].join('\n')}\n`

    // Written once as soon as the shell pid is known, and again per phase: the first poll happens
    // at spawn, so the table must already show the shell and its descendants by then.
    await writeFile(tableFile, render(plan[0]?.rows ?? []))

    for (const phase of plan) {
      if (phase.afterMs) await new Promise((resolve) => setTimeout(resolve, phase.afterMs))
      await writeFile(tableFile, render(phase.rows))
    }

    // The runner writes its ancestry memory on its own 500ms cadence, so a read taken the
    // instant the last phase lands races the poll that would have observed it. Two full
    // cadences cover the poll that reads the final table plus the write it performs.
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    return { known: await readKnown(evidence), exitCode: await awaitExit(child, opts.waitMs) }
  }

  /** Resolves with the runner's exit code, or `null` while it is still anchoring the task. */
  const awaitExit = (child: ReturnType<typeof spawn>, waitMs: number): Promise<number | null> =>
    Promise.race([
      new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1))),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))
    ])

  const readKnown = async (evidence: string): Promise<number[]> => {
    try {
      const parsed = JSON.parse(await readFile(evidence, 'utf8')) as { known?: Array<{ pid: number }> }
      return (parsed.known ?? []).map((entry) => entry.pid)
    } catch {
      return []
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-ancestry-'))
    liveProbes = []
  })
  afterEach(async () => {
    // A probe that is still anchoring writes evidence while the directory is removed, and the
    // removal then fails ENOTEMPTY: stop it first, then let a late write settle.
    for (const child of liveProbes) child.kill('SIGKILL')
    liveProbes = []
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined)
  })

  it('keeps a worker whose parenting intermediate exited while the shell still ran', async () => {
    // shell → intermediate → worker: the intermediate forks the worker and exits while the shell
    // is still alive, so the worker ends up parented to a pid no live row names. The runner's
    // ancestry may only be seeded through parents it has verified while they lived, and the
    // observed identity has to survive the parent's exit — otherwise two probes report the tree
    // empty, publish completion, and drop the worker from Stop/Kill and the live-task inventory
    // while it is still working.
    const { known, exitCode } = await runProbe(
      [
        {
          afterMs: 0,
          // The intermediate is a child of the live shell; the worker is a child of it.
          rows: [
            [900_002, 'shell', T_MID],
            [900_001, 900_002, T_WORKER]
          ]
        },
        // The intermediate exits while the shell lives, leaving only the worker behind it.
        { afterMs: 700, rows: [[900_001, 900_002, T_WORKER]] }
      ],
      // The worker is a member of the task's job, recorded when the OS created it — the membership
      // that survives the intermediate's exit and ties the orphan to the task.
      { shellLifetimeMs: 1_500, waitMs: 4_000, members: '[900001]' }
    )

    expect(known).toContain(900_001)
    // The worker is still in the table, so the anchor may not have left.
    expect(exitCode).toBeNull()
  })

  it('refuses a child whose remembered parent pid an unrelated process has taken over', async () => {
    // shell → worker → child, then the worker exits and Windows hands its pid to a stranger who
    // forks a child of its own. A remembered pid is only a number, so admitting the stranger's
    // child writes it into the evidence file — which is what the app's termination collector
    // walks from, so Stop/Kill and the permanent purge would take the stranger's tree down.
    const { known } = await runProbe(
      [
        {
          afterMs: 0,
          // The worker is the shell's child; the task's own grandchild hangs off it.
          rows: [
            [900_002, 'shell', T_MID],
            [900_001, 900_002, T_WORKER]
          ]
        },
        // The worker and its grandchild are gone: the pid is free again. This phase lasts long
        // enough for a poll to run over it, so the walk has certainly forgotten the live worker
        // before the stranger takes its number.
        { afterMs: 1_200, rows: [[900_002, 'shell', T_MID]] },
        // A stranger takes the freed pid, stamped later than the worker ever was, and forks a
        // child of its own after it. The pid is remembered, so a walk that trusts the number
        // alone reads the stranger's child as the task's own descendant.
        {
          afterMs: 900,
          rows: [
            [900_002, 'shell', T_MID],
            [900_001, 900_002, T_REUSED],
            [900_003, 900_001, T_REUSED_CHILD]
          ]
        }
      ],
      // The shell outlives every phase, so the final table is what a still-anchored task reads:
      // the anchor may only leave once the walk can account for what the table still shows.
      { shellLifetimeMs: 5_000, waitMs: 8_000 }
    )

    // The stranger's child is not this task's work: admitting it would extend a kill to it.
    expect(known).not.toContain(900_003)
  })
})
