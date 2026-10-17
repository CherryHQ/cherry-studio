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
  getDetachedBackgroundTask,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask
} from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`
const TABLE_HEADER = '"ProcessId","ParentProcessId","CreationDate"'
/** The creation stamp the fake identity query reports for the runner and the shell it spawned. */
const SPAWN_STAMP = '20261017000000.000000+480'

// The suite simulates the Windows process table on a POSIX host: the stand-in probe is a shell
// script, which a real Windows runner cannot execute, so the simulation itself only runs where
// there is no real PowerShell to answer instead of the fake table.
describe.skipIf(process.platform === 'win32')('a Windows task whose shell exits before its work', () => {
  let storageDir: string
  let shimDir: string
  let fakeTable: string
  let realPlatform: NodeJS.Platform
  let realPath: string | undefined

  /**
   * Puts a stand-in `powershell.exe` on PATH that prints a fake process table. `withStamps: false`
   * answers the spawn-time identity query with a header only, the way a failed query reads, and
   * `fingerprintDelayMs` holds the answer back the way a loaded runner's five-second query is.
   */
  const useFakeProbe = async (
    rows: string,
    opts: { fingerprintDelayMs?: number; withStamps?: boolean } = {}
  ): Promise<void> => {
    shimDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-probe-'))
    fakeTable = path.join(shimDir, 'table.csv')
    await writeFile(fakeTable, rows)
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
            '  printf \'"%s","20261017000000.000000+480"\\n\' "$PPID"',
            '  if [ -n "$shell_pid" ]; then printf \'"%s","20261017000000.000000+480"\\n\' "$shell_pid"; fi'
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
  }

  const writeFakeRows = async (rows: string): Promise<void> => {
    await writeFile(fakeTable, rows)
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

  it('still completes when no process-table probe exists', async () => {
    // No shim on PATH: the runner cannot read evidence at all, so it cannot hold the anchor open
    // and settles on the shell's own status rather than never settling.
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
        `"${shellPid}","4","20261017000010.000000+480"`,
        `"8888","${shellPid}","20261017000011.000000+480"`,
        `"999999","${shellPid}","20261017000005.000000+480"`
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
      `"${shellPid}","4","20261017000010.000000+480"`,
      `"8888","${shellPid}","20261017000011.000000+480"`
    ]
    await writeFakeRows(`${[...replacementRows, `"999999","${shellPid}","20261017000005.000000+480"`].join('\n')}\n`)

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
