import type * as ChildProcessModule from 'node:child_process'
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
const TABLE_HEADER = '"ProcessId","ParentProcessId"'

describe('a Windows task whose shell exits before its work', () => {
  let storageDir: string
  let shimDir: string
  let fakeTable: string
  let realPlatform: NodeJS.Platform
  let realPath: string | undefined

  /** Puts a stand-in `powershell.exe` on PATH that prints a fake process table. */
  const useFakeProbe = async (rows: string): Promise<void> => {
    shimDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-probe-'))
    fakeTable = path.join(shimDir, 'table.csv')
    await writeFile(fakeTable, rows)
    const shim = path.join(shimDir, 'powershell.exe')
    await writeFile(shim, `#!/bin/sh\nsed "s/@PPID@/$PPID/g" "$BG_FAKE_TABLE" 2>/dev/null\nexit 0\n`)
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
    await useFakeProbe(`${TABLE_HEADER}\n"999999","@PPID@"\n`)
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
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}"\n`)

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
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}"\n`)
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
    await writeFakeRows(`${TABLE_HEADER}\n"999999","${shellPid}"\n`)
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
})
