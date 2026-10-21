import type * as ChildProcessModule from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The stop shells out to `taskkill`, a real process spawn that outlives a fast exit: only
// `taskkill` is mocked here, so the stop's own bookkeeping is what is under test. The process
// table reads stay real — both the runner and the stop consult the fake probe below through it.
const { taskkillMock } = vi.hoisted(() => ({ taskkillMock: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const routed = ((file: string, args: string[], options: unknown, callback: (error: Error | null) => void) => {
    if (file === 'taskkill') return taskkillMock(file, args, options, callback)
    return actual.execFile(file, args, options as never, callback)
  }) as typeof actual.execFile
  return {
    ...actual,
    execFile: routed
  }
})

import {
  BACKGROUND_TASK_EVIDENCE_EXT,
  BACKGROUND_TASK_LOG_EXT,
  getDetachedBackgroundTask,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask
} from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`
const TABLE_HEADER = '"ProcessId","ParentProcessId","CreationDate"'
/**
 * Creation stamps as the identity queries emit them: FILETIME ticks from
 * `CreationDate.ToUniversalTime().Ticks`, not the culture-formatted CSV text. The pair around
 * 10:00:00 is the ordering hazard this guards: read as text, `9:59:59` sorts after `10:00:00`.
 */
const SPAWN_STAMP = '639281447900000000' // 2026-10-21 09:59:50 local
const ORPHAN_STAMP = '639281447950000000' // 2026-10-21 09:59:55 local
const REUSED_STAMP = '639281447990000000' // 2026-10-21 09:59:59 local
const REUSED_CHILD_STAMP = '639281448000000000' // 2026-10-21 10:00:00 local

// The suite simulates the Windows process table on a POSIX host: the stand-in probe is a shell
// script, which a real Windows runner cannot execute, so the simulation itself only runs where
// there is no real PowerShell to answer instead of the fake table.
describe.skipIf(process.platform === 'win32')('a Windows task whose shell exits before its work', () => {
  let storageDir: string
  let shimDir: string
  let fakeTable: string
  let fakeMembers: string
  let realPlatform: NodeJS.Platform
  let realPath: string | undefined

  /**
   * Puts a stand-in `powershell.exe` on PATH that prints a fake process table and serves the job
   * keeper protocol. `withStamps: false` answers the spawn-time identity query with a header only,
   * the way a failed query reads, and `fingerprintDelayMs` holds the answer back the way a loaded
   * runner's five-second query is. `members` seeds the OS-held job membership, the list the runner
   * may not settle while it is non-empty.
   */
  const useFakeProbe = async (
    rows: string,
    opts: { fingerprintDelayMs?: number; keepJob?: boolean; members?: string; withStamps?: boolean } = {}
  ): Promise<void> => {
    shimDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-probe-'))
    fakeTable = path.join(shimDir, 'table.csv')
    await writeFile(fakeTable, rows)
    fakeMembers = path.join(shimDir, 'members.json')
    await writeFile(fakeMembers, opts.members ?? '[]')
    const shim = path.join(shimDir, 'powershell.exe')
    // The spawn-time identity query (a `-Filter` select of the creation stamps) is answered from
    // the runner's own pid — the shim's $PPID — and the shell pid named in the filter itself.
    const fingerprintQuery = [
      'case "$*" in',
      '*-Filter*)',
      ...(opts.fingerprintDelayMs ? [`  sleep ${Math.max(1, Math.round(opts.fingerprintDelayMs / 1000))}`] : []),
      ...(opts.withStamps === false
        ? ['  printf \'"ProcessId","CreationDate"\\n\'']
        : [
            '  shell_pid=$(printf \'%s\' "$*" | sed -n "s/.*ProcessId=[0-9][0-9]* or ProcessId=\\([0-9][0-9]*\\).*/\\1/p")',
            '  printf \'"ProcessId","CreationDate"\\n\'',
            `  printf '"%s","${SPAWN_STAMP}"\\n' "$PPID"`,
            `  if [ -n "$shell_pid" ]; then printf '"%s","${SPAWN_STAMP}"\\n' "$shell_pid"; fi`
          ]),
      '  ;;',
      // The job keeper: it reports itself ready once the membership is held, then republishes the
      // controlled membership until the runner it belongs to is gone.
      '*-File*)',
      ...(opts.keepJob === false
        ? ['  exit 3']
        : [
            '  printf \'ready\' > "$CHERRY_BG_JOB_READY"',
            '  last=""',
            '  while kill -0 "$CHERRY_BG_JOB_RUNNER" 2>/dev/null; do',
            '    if [ -f "$CHERRY_BG_JOB_REQUEST" ]; then',
            '      nonce=$(cat "$CHERRY_BG_JOB_REQUEST" 2>/dev/null)',
            '      if [ -n "$nonce" ] && [ "$nonce" != "$last" ]; then',
            '        last="$nonce"',
            '        members=$(cat "$BG_FAKE_MEMBERS" 2>/dev/null)',
            '        printf \'{"nonce":"%s","pids":%s}\' "$nonce" "${members:-[]}" > "$CHERRY_BG_JOB_FILE.staging" &&',
            '          mv "$CHERRY_BG_JOB_FILE.staging" "$CHERRY_BG_JOB_FILE" 2>/dev/null',
            '      fi',
            '    fi',
            '    sleep 0.05',
            '  done'
          ]),
      '  ;;',
      '*)',
      '  sed "s/@PPID@/$PPID/g" "$BG_FAKE_TABLE" 2>/dev/null',
      '  ;;',
      'esac',
      'exit 0'
    ].join('\n')
    await writeFile(shim, `#!/bin/sh\n${fingerprintQuery}\n`)
    await chmod(shim, 0o755)
    process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH}`
    process.env.BG_FAKE_TABLE = fakeTable
    process.env.BG_FAKE_MEMBERS = fakeMembers
  }

  const writeFakeRows = async (rows: string): Promise<void> => {
    await writeFile(fakeTable, rows)
  }

  /** Replaces the OS-held membership the runner may not publish completion past. */
  const writeFakeMembers = async (members: string): Promise<void> => {
    await writeFile(fakeMembers, members)
  }

  /** The shell pid the runner recorded at spawn — the root of everything the shell left behind. */
  const waitForShellPid = async (taskId: string): Promise<number> => {
    const evidence = path.join(storageDir, `${taskId}${BACKGROUND_TASK_EVIDENCE_EXT}`)
    await vi.waitFor(
      async () => {
        expect(Number(JSON.parse(await readFile(evidence, 'utf8')).shellPid)).toBeGreaterThan(0)
      },
      { timeout: 10_000 }
    )
    return Number(JSON.parse(await readFile(evidence, 'utf8')).shellPid)
  }

  /** Lets every taskkill through resolved, the way an effective kill reports. */
  const letTaskkillThrough = (): void => {
    taskkillMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
  }

  beforeEach(async () => {
    // The Windows branch of the spawn factory is what selects the runner under test; the runner
    // itself sees the real platform, so the fake probe below is what it consults.
    realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    realPath = process.env.PATH
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-shell-exit-'))
  })

  afterEach(async () => {
    // Empty the fake table so any live runner reads a drained tree and exits instead of polling
    // a survivor that only exists inside the test.
    if (fakeTable) await writeFile(fakeTable, `${TABLE_HEADER}\n`).catch(() => undefined)
    if (realPath !== undefined) process.env.PATH = realPath
    delete process.env.BG_FAKE_TABLE
    delete process.env.BG_FAKE_MEMBERS
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    taskkillMock.mockReset()
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        await rm(storageDir, { recursive: true, force: true })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (Date.now() >= deadline || (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM')) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }, 20_000)

  it('does not hold the anchor open for its own process probe', async () => {
    // Every successful probe is itself a runner child in the very table it reads. Counted as
    // work, the tree can never read as drained and no task ever completes; only the shell may
    // descend from the runner.
    await useFakeProbe(`${TABLE_HEADER}\n"999999","@PPID@","${SPAWN_STAMP}"\n`)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "process.exit(0)"`,
      cwd: storageDir
    })

    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'completed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
  })

  it('keeps the task running while escaped work survives', async () => {
    // The worker survives its shell, so its row stays parented to the shell pid the runner
    // recorded: the probe keeps reporting it, so the tree never reads as drained.
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n`)

    // The shell is gone and its orphan keeps working: the runner anchors the task, so the
    // record must still read running.
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })
  })

  it('keeps an escaped worker tracked when the kill cannot prove it stopped', async () => {
    // `taskkill /T` follows live parents only, so a worker behind a shell that has already
    // exited is not reached. With the table still reporting it, the task may not be published
    // as `stopped` — reconciliation and the permanent purge trust that word, and a survivor
    // would lose its tracking and controls while its work goes on.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n`)
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    letTaskkillThrough()
    const withheld = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

    expect(withheld?.status).toBe('running')
    expect(withheld?.stopRequestedAt).toEqual(expect.any(String))
    expect(onExit).not.toHaveBeenCalled()
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })
  }, 20_000)

  it('publishes the kill once nothing of the task is left in the table', async () => {
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n`)
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    letTaskkillThrough()
    const stopped = stopDetachedBackgroundTask(storageDir, record.id, true, onExit)
    // The kill lands: the table no longer reports the escaped work.
    await writeFakeRows(`${TABLE_HEADER}\n`)
    await expect(stopped).resolves.toMatchObject({ status: 'stopped' })

    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit.mock.calls[0][0].record.status).toBe('stopped')
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'stopped' })
  }, 20_000)

  it('refuses to start a task when no PowerShell exists to supervise it', async () => {
    // No shim on PATH: there is no process table and no Job Object, so a completion could only be
    // read from the shell's own exit while a worker it backgrounded lives on. The runner must
    // refuse before the command runs rather than publish that work as done.
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)" &`,
      cwd: storageDir
    })

    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'failed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
    // The backgrounded worker was never created: nothing ran without supervision.
    await expect(readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_LOG_EXT}`), 'utf8')).resolves.toBe('')
  })

  it('refuses to start a task whose durable membership cannot be held', async () => {
    // PowerShell answers, but the job cannot be established — Add-Type blocked, or the process
    // already inside a job that refuses the assignment. Without the membership no completion can
    // ever be certified, so the runner must fail the start rather than run work that could be
    // published as done while it still runs.
    await useFakeProbe(TABLE_HEADER, { keepJob: false })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "process.exit(0)"`,
      cwd: storageDir
    })

    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'failed' })
      },
      { timeout: 10_000, interval: 100 }
    )
    // The command never ran, so there is no work the refusal could have stranded.
    await expect(readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_LOG_EXT}`), 'utf8')).resolves.toBe('')
  }, 20_000)

  it('refuses to force-kill a recorded pid an unrelated process has taken over', async () => {
    // The shell exited and Windows handed its pid to a stranger, which has since forked a child
    // of its own; the task's real orphan worker was created before the takeover. A closure that
    // trusts the recorded pid alone force-kills the stranger's tree, so the sweep must verify
    // each recorded root's creation stamp and spare everything the replacement brought along.
    const onExit = vi.fn()
    const requested: string[][] = []
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 200)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // pid `shellPid` now names the replacement, `8888` is the replacement's own child, and
    // `999999` is the task's orphan worker, created before the replacement took the pid.
    await writeFakeRows(
      [
        TABLE_HEADER,
        `"${shellPid}","4","${REUSED_STAMP}"`,
        `"8888","${shellPid}","${REUSED_CHILD_STAMP}"`,
        `"999999","${shellPid}","${ORPHAN_STAMP}"`
      ].join('\n') + '\n'
    )

    taskkillMock.mockImplementation((...args: unknown[]) => {
      const called = args[1] as string[]
      requested.push(called)
      // The orphan's kill lands: the table no longer reports it, so verification can pass.
      if (called.includes('999999')) writeFileSync(fakeTable, `${TABLE_HEADER}\n`)
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

    expect(stopped?.status).toBe('stopped')
    expect(requested.some((args) => args.includes('999999'))).toBe(true)
    expect(requested.flat()).not.toContain(String(shellPid))
    expect(requested.flat()).not.toContain('8888')
    expect(onExit).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('does not adopt a replacement shell pid before the identity probe has stamped it', async () => {
    // The shell exited and the OS reused its pid for an unrelated process that has since forked a
    // child of its own. The recorded shell pid is the one root the record names, so the runner's
    // walk still reaches it — but the replacement reads a different creation stamp from the one
    // captured at spawn, so the walk must not extend the task's ownership through it to whatever
    // it has since forked. A walk that admits everything parented to the recorded pid persists a
    // stranger's subtree as this task's verified work, which is what a later kill then takes down.
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 300)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // `999999` is the task's own orphan worker, created under the shell the runner recorded.
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n`)
    // The orphan is observed and remembered across the polls the shell's exit starts; then the
    // shell's row is gone — which is why its number was reusable — and a stranger now holds the
    // pid with a child of its own.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    // The shell's own row is gone — which is why its number was reusable — while the task's own
    // orphan keeps running and the stranger that took the pid has forked a child of its own.
    await writeFakeRows(
      [
        TABLE_HEADER,
        `"7777","${shellPid}","${REUSED_STAMP}"`,
        `"4444","7777","${REUSED_CHILD_STAMP}"`,
        `"999999","${shellPid}","${SPAWN_STAMP}"`
      ].join('\n') + '\n'
    )

    const readKnownPids = async (): Promise<number[]> => {
      const evidence = JSON.parse(
        await readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_EVIDENCE_EXT}`), 'utf8')
      )
      return ((evidence.known ?? []) as Array<{ pid: number }>).map((entry) => entry.pid)
    }

    // The task's own orphan is remembered as its verified work; the replacement's subtree is not.
    await vi.waitFor(
      async () => {
        expect(await readKnownPids()).toContain(999_999)
      },
      { timeout: 10_000, interval: 200 }
    )
    expect(await readKnownPids()).not.toContain(7_777)
    expect(await readKnownPids()).not.toContain(4_444)
  }, 20_000)

  it('does not adopt a stranger subtree when the shell stamp was never captured', async () => {
    // A short-lived shell can exit before the startup identity query stamps it, and the OS then
    // hands its number to a stranger while the task's own worker lives on. A live occupant this
    // app holds no stamp for proves nothing about the children it has forked: only a row created
    // before that occupant existed cannot be its child, so only those stay attributable.
    await useFakeProbe(TABLE_HEADER, { withStamps: false })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // `shellPid` now names the replacement, `8888` is the replacement's own child, and `999999`
    // is the task's orphan worker, created before the replacement took the number.
    await writeFakeRows(
      [
        TABLE_HEADER,
        `"${shellPid}","4","${REUSED_STAMP}"`,
        `"8888","${shellPid}","${REUSED_CHILD_STAMP}"`,
        `"999999","${shellPid}","${ORPHAN_STAMP}"`
      ].join('\n') + '\n'
    )

    const readKnownPids = async (): Promise<number[]> => {
      const evidence = JSON.parse(
        await readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_EVIDENCE_EXT}`), 'utf8')
      )
      return ((evidence.known ?? []) as Array<{ pid: number }>).map((entry) => entry.pid)
    }

    // The pre-takeover orphan is the task's own work; the replacement's child is not.
    await vi.waitFor(
      async () => {
        expect(await readKnownPids()).toContain(999_999)
      },
      { timeout: 10_000, interval: 200 }
    )
    expect(await readKnownPids()).not.toContain(8_888)
  }, 20_000)

  it('does not order culture-formatted stamps lexically in the stop walk', async () => {
    // Windows reports `CreationDate` as culture text, where `10:00:00 AM` sorts before `9:59:59 AM`.
    // A replacement that took the shell's pid at 9:59:59 and forked a child at 10:00:00 must not
    // read that child as older than the occupant: it is the replacement's, not this task's work.
    const onExit = vi.fn()
    const requested: string[][] = []
    await useFakeProbe(TABLE_HEADER, { withStamps: false })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(
      [
        TABLE_HEADER,
        `"${shellPid}","4","10/21/2026 9:59:59 AM"`,
        `"8888","${shellPid}","10/21/2026 10:00:00 AM"`,
        `"999999","${shellPid}","10/21/2026 9:59:55 AM"`
      ].join('\n') + '\n'
    )

    taskkillMock.mockImplementation((...args: unknown[]) => {
      requested.push(args[1] as string[])
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const withheld = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

    // Culture text carries no chronology: the replacement's child may never be adopted as work.
    expect(requested.flat()).not.toContain('8888')
    // The occupant cannot be tied to the task, so termination stays unproven.
    expect(withheld?.status).toBe('running')
    expect(onExit).not.toHaveBeenCalled()
  }, 20_000)

  it('does not order culture-formatted stamps lexically when extending ancestry', async () => {
    // The same hazard inside the runner: its ancestry walk must not read the replacement's
    // 10:00:00 AM child as earlier than the 9:59:59 AM occupant and persist it as verified work.
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(
      [TABLE_HEADER, `"${shellPid}","4","10/21/2026 9:59:59 AM"`, `"8888","${shellPid}","10/21/2026 10:00:00 AM"`].join(
        '\n'
      ) + '\n'
    )

    const readKnownPids = async (): Promise<number[]> => {
      const evidence = JSON.parse(
        await readFile(path.join(storageDir, `${record.id}${BACKGROUND_TASK_EVIDENCE_EXT}`), 'utf8')
      )
      return ((evidence.known ?? []) as Array<{ pid: number }>).map((entry) => entry.pid)
    }

    // Several polls' worth of time: a lexical comparison would have admitted it on the first one.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await readKnownPids()).not.toContain(8_888)
  }, 20_000)

  it('spares a replacement whose recorded root carries no identity stamp', async () => {
    // The startup identity query failed, so the evidence holds the shell pid and no stamps. A
    // replacement then takes that pid, forks a child of its own, and the task's orphan — created
    // before the takeover — still runs beside them. A sweep that trusts the bare pid force-kills
    // the stranger's tree; without a stamp a live root authorizes no termination at all, and a
    // live root this app cannot account for keeps the task unresolved instead of reading stopped.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER, { withStamps: false })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // pid `shellPid` now names the replacement, `8888` is the replacement's own child, and
    // `999999` is the task's orphan worker, created before the replacement took the pid.
    const replacementRows = [
      TABLE_HEADER,
      `"${shellPid}","4","${REUSED_STAMP}"`,
      `"8888","${shellPid}","${REUSED_CHILD_STAMP}"`
    ]
    await writeFakeRows(`${[...replacementRows, `"999999","${shellPid}","${ORPHAN_STAMP}"`].join('\n')}\n`)

    const requested: string[][] = []
    taskkillMock.mockImplementation((...args: unknown[]) => {
      const called = args[1] as string[]
      requested.push(called)
      // Only the orphan's kill lands: the stranger and its child keep their rows.
      if (called.includes('999999')) writeFileSync(fakeTable, `${replacementRows.join('\n')}\n`)
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const withheld = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

    // The orphan was the task's to kill; the stranger and its child were not.
    expect(requested.some((args) => args.includes('999999'))).toBe(true)
    expect(requested.flat()).not.toContain(String(shellPid))
    expect(requested.flat()).not.toContain('8888')
    // No stamp ties the live replacement to the task, so nothing may call the task stopped.
    expect(withheld?.status).toBe('running')
    expect(onExit).not.toHaveBeenCalled()
  }, 30_000)

  it('waits out the evidence write a kill arriving too early would destroy', async () => {
    // Start returns while the runner is still inside its identity query — the query whose write
    // every later walk seeds from. A kill landing first destroys `.pids`' only writer, and the
    // record then hangs unresolved forever: no verification, no completion, no purge. The stop
    // must wait out the write, and the kill that follows must publish through it.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER, { fingerprintDelayMs: 1_000 })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 3_000)"`,
      cwd: storageDir
    })

    letTaskkillThrough()
    const stopped = stopDetachedBackgroundTask(storageDir, record.id, true, onExit)
    // The delayed write lands inside the stop's wait, so the kill proceeds on recorded evidence.
    await expect(stopped).resolves.toMatchObject({ status: 'stopped' })
    expect(onExit).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('recovers a task whose runner died before any evidence existed', async () => {
    // A runner killed inside its identity query never writes `.pids` at all. With the writer gone
    // there is no root left to walk and no read that can ever differ, so the record must settle
    // as stopped instead of hanging past every control path.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER, { fingerprintDelayMs: 3_000 })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 5_000)"`,
      cwd: storageDir
    })

    letTaskkillThrough()
    const stopped = stopDetachedBackgroundTask(storageDir, record.id, true, onExit)
    // The kill takes the runner down while the stop holds its request on the record.
    await new Promise((resolve) => setTimeout(resolve, 100))
    process.kill(record.pid, 'SIGKILL')
    await expect(stopped).resolves.toMatchObject({ status: 'stopped' })
    expect(onExit).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('reaches a remembered grandchild when the kill destroys the runner that saw it', async () => {
    // shell → worker → grandchild: the runner observes both across its polls, then the worker
    // exits and only the grandchild is left. A kill takes the runner — and its ancestry memory —
    // down with it, so the app's own walk must re-seed from the evidence the runner wrote, or it
    // reports the tree empty while the grandchild survives past both dead links.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 300)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(
      `${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n"888888","999999","${SPAWN_STAMP}"\n`
    )
    // Both members are observed and remembered across the polls the shell's exit starts; then the
    // worker exits and its row goes with it.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await writeFakeRows(`${TABLE_HEADER}\n"888888","999999","${SPAWN_STAMP}"\n`)

    const requested: string[][] = []
    taskkillMock.mockImplementation((...args: unknown[]) => {
      const called = args[1] as string[]
      requested.push(called)
      // The grandchild's kill lands: the table no longer reports it, so verification can pass.
      if (called.includes('888888')) writeFileSync(fakeTable, `${TABLE_HEADER}\n`)
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const stopped = stopDetachedBackgroundTask(storageDir, record.id, true, onExit)
    // The kill takes the runner itself while the grandchild survives past both dead links.
    await new Promise((resolve) => setTimeout(resolve, 300))
    process.kill(record.pid, 'SIGKILL')
    await expect(stopped).resolves.toMatchObject({ status: 'stopped' })
    // The publish is honest only if the sweep itself reached the grandchild.
    expect(requested.some((args) => args.includes('888888'))).toBe(true)
    expect(onExit).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('keeps a kill survivor unresolved when the killed runner reports its own exit', async () => {
    // Kill takes the runner down while a worker behind the dead shell survives: the runner's
    // close event must not convert the stop into a finished task. The completion may only
    // publish once the table verifies the worker is truly gone.
    const startOnExit = vi.fn()
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir,
      onExit: startOnExit
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n`)
    letTaskkillThrough()

    const withheld = stopDetachedBackgroundTask(storageDir, record.id, true, vi.fn())
    // Kill reaches the runner itself: its close event fires while the worker is still listed.
    await new Promise((resolve) => setTimeout(resolve, 300))
    process.kill(record.pid, 'SIGKILL')
    await expect(withheld).resolves.toMatchObject({ status: 'running', stopRequestedAt: expect.any(String) })
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The unresolved record holds: no completion, no notification, while the survivor works on.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(startOnExit).not.toHaveBeenCalled()
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The survivor is gone: only then does the verified drain publish the kill.
    await writeFakeRows(`${TABLE_HEADER}\n`)
    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'stopped' })
      },
      { timeout: 10_000, interval: 100 }
    )
    await vi.waitFor(() => expect(startOnExit).toHaveBeenCalledTimes(1), { timeout: 10_000 })
  }, 30_000)

  it('refuses to signal a live runner whose spawn identity was never captured', async () => {
    // The startup identity query failed, so the evidence carries no runner stamp — yet the runner
    // wrote the file and keeps working. If Windows hands the recorded runner pid to someone else,
    // a kill that trusts the bare number takes down the unrelated occupant's tree, and the later
    // descendant walk cannot undo that signal. Without a stamp a live occupant is unverifiable,
    // so the stop must leave the record unresolved instead of signalling it.
    const onExit = vi.fn()
    await useFakeProbe(TABLE_HEADER, { withStamps: false })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 60_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // The recorded runner pid now names an unrelated occupant; the task's own orphan still runs.
    await writeFakeRows(
      [TABLE_HEADER, `"${record.pid}","4","${REUSED_STAMP}"`, `"999999","${shellPid}","${ORPHAN_STAMP}"`].join('\n') +
        '\n'
    )
    const requested: string[][] = []
    taskkillMock.mockImplementation((...args: unknown[]) => {
      requested.push(args[1] as string[])
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const withheld = await stopDetachedBackgroundTask(storageDir, record.id, true, onExit)

    // Nothing at the unverified number may be signalled: not the occupant and not its tree.
    expect(requested.flat()).not.toContain(String(record.pid))
    expect(withheld).toBeUndefined()
    expect(onExit).not.toHaveBeenCalled()
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })
  }, 20_000)

  it('keeps tracking a worker whose parent exited while the shell was still running', async () => {
    // shell → intermediate → worker: the intermediate forks the worker and exits while the shell
    // still runs. The worker's parent pid then names a process no longer in the table, so tracking
    // that begins only at shell exit never sees the intermediate and cannot keep the worker: two
    // empty probes publish completion while it works. Tracking across the whole task lifetime
    // observes the intermediate while it lives, so its worker stays attributable afterwards.
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 3_000)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    // Both members are alive while the shell runs; a lifetime probe records them.
    await writeFakeRows(
      `${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n"888888","999999","${SPAWN_STAMP}"\n`
    )
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    // The intermediate exits and only the worker it forked is left, parented to a dead pid.
    await writeFakeRows(`${TABLE_HEADER}\n"888888","999999","${SPAWN_STAMP}"\n`)

    // The shell has exited by now and the worker survives behind the dead intermediate: the task
    // may not be published as completed while it still works.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The worker is gone too: the tree reads empty and the runner may settle.
    await writeFakeRows(`${TABLE_HEADER}\n`)
    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'completed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
  }, 30_000)

  it('keeps a job member the ancestry walk never saw before publishing completion', async () => {
    // shell → intermediate → worker can run entirely between two samples: the intermediate is
    // never in the table, so no reading ties the surviving worker to the task. The OS records the
    // membership when the worker is created, though, so an empty ancestry walk is not proof while
    // the job still holds a process — and two empty readings may not end the runner.
    await useFakeProbe(TABLE_HEADER, { members: '[400]' })
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "process.exit(0)"`,
      cwd: storageDir
    })
    await waitForShellPid(record.id)

    // The shell and its command are gone; only the unsampled worker survives, and only the job
    // knows it. Completion would remove its controls and its deletion/restore safeguards.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The worker exits: the durable membership drains and the runner may settle on the shell's
    // own status.
    await writeFakeMembers('[]')
    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'completed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
  }, 30_000)

  it('keeps counting a grandchild whose worker parent died between polls', async () => {
    // shell → worker → child: once the worker exits, the surviving child's parent pid no longer
    // connects to any recorded root. The polls must remember the members they verified — the
    // worker's death may not drop its already-observed descendants from the tree.
    await useFakeProbe(TABLE_HEADER)
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => process.exit(0), 300)"`,
      cwd: storageDir
    })
    const shellPid = await waitForShellPid(record.id)
    await writeFakeRows(
      `${TABLE_HEADER}\n"999999","${shellPid}","${SPAWN_STAMP}"\n"888888","999999","${SPAWN_STAMP}"\n`
    )
    // Both members are verified by earlier polls; then the worker exits and only the child is left.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await writeFakeRows(`${TABLE_HEADER}\n"888888","999999","${SPAWN_STAMP}"\n`)

    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The child is gone too: the tree reads empty and the runner may settle.
    await writeFakeRows(`${TABLE_HEADER}\n`)
    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'completed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
  }, 30_000)
})
