import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WINDOWS_DETACHED_TASK_RUNNER } from '../backgroundTasks'

const TABLE_HEADER = '"ProcessId","ParentProcessId","CreationDate"'
/** Realistic creation order: the runner, then its shell, then the shell's child, then its child. */
const T_RUNNER = '20261017000000.000000+480'
const T_SHELL = '20261017000001.000000+480'
const T_MID = '20261017000002.000000+480'
const T_WORKER = '20261017000003.000000+480'

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
*) cat "$BG_FAKE_TABLE" ;;
esac
exit 0`

/** One row of the simulated Windows process table, resolved once the shell pid is known. */
type ProbeRow = [pid: number, parent: number | 'shell', created: string]

describe.skipIf(process.platform === 'win32')('the runner seeds ancestry from live parents', () => {
  let dir: string

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
    opts: { shellLifetimeMs: number; waitMs: number }
  ): Promise<{ known: number[]; exitCode: number | null }> => {
    const tableFile = path.join(dir, 'table.csv')
    const evidence = path.join(dir, 'bt-probe.pids')
    const shimDir = path.join(dir, 'shim')
    await writeFile(tableFile, TABLE_HEADER)
    await mkdir(shimDir, { recursive: true })
    const shim = path.join(shimDir, 'powershell.exe')
    await writeFile(shim, `${SHIM}\n`)
    await chmod(shim, 0o755)

    const command = `"${process.execPath}" -e "setTimeout(() => {}, ${opts.shellLifetimeMs})"`
    const child = spawn(process.execPath, ['-e', WINDOWS_DETACHED_TASK_RUNNER, command, evidence], {
      cwd: dir,
      env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}`, BG_FAKE_TABLE: tableFile },
      stdio: ['ignore', 'ignore', 'ignore']
    })

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
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
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
      { shellLifetimeMs: 1_500, waitMs: 4_000 }
    )

    expect(known).toContain(900_001)
    // The worker is still in the table, so the anchor may not have left.
    expect(exitCode).toBeNull()
  })
})
