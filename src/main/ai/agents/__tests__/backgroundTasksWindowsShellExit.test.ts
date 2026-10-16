import type * as ChildProcessModule from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The runner stops a task through `taskkill`, a real process spawn that outlives a fast exit:
// the mock resolves it instead, so the stop's own bookkeeping is what is under test. Spawn and
// execFileSync stay real — the runner is a separate process nothing here can mock.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    execFile: execFileMock
  }
})

import {
  getDetachedBackgroundTask,
  isPidAlive,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask
} from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`

// A worker that outlives its shell: it prints its pid and keeps running after the shell exits —
// the shape a backgrounded job (`start "" /b …`) leaves behind on Windows.
const orphanWorkerCommand = `${nodeBin} -e "process.stdout.write(String(process.pid)); setInterval(() => {}, 60_000)" &`

describe('a Windows task whose shell exits before its work', () => {
  let storageDir: string
  let shimDir: string
  let fakeTable: string
  let realPlatform: NodeJS.Platform
  let realPath: string | undefined
  let lastWorkerPid = 0

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

  const waitForWorkerPid = async (logFile: string): Promise<number> => {
    await vi.waitFor(
      async () => {
        expect((await readFile(logFile, 'utf8')).trim()).toMatch(/^\d+$/)
      },
      { timeout: 10_000 }
    )
    const workerPid = Number((await readFile(logFile, 'utf8')).trim())
    expect(isPidAlive(workerPid)).toBe(true)
    return workerPid
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
    if (fakeTable) await writeFile(fakeTable, '"ProcessId","ParentProcessId"\n').catch(() => undefined)
    if (lastWorkerPid > 0) {
      try {
        process.kill(lastWorkerPid, 'SIGKILL')
      } catch {
        // already gone
      }
      lastWorkerPid = 0
    }
    if (realPath !== undefined) process.env.PATH = realPath
    delete process.env.BG_FAKE_TABLE
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    execFileMock.mockReset()
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

  it('keeps the task running and stoppable while escaped work survives', async () => {
    // A row whose parent is the runner itself stands in for the worker the shell backgrounded:
    // the probe keeps reporting it, so the tree never reads as drained.
    await useFakeProbe('"ProcessId","ParentProcessId"\n"999999","@PPID@"\n')
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: orphanWorkerCommand,
      cwd: storageDir
    })
    lastWorkerPid = await waitForWorkerPid(record.logFile)

    // The shell is gone — its orphan printed its pid — but the runner anchors the task, so the
    // record must still read running and Stop/Kill must still reach it.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const held = await getDetachedBackgroundTask(storageDir, record.id)
    expect(held?.status).toBe('running')

    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      setTimeout(() => callback(null), 20)
    })
    const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true)
    expect(stopped?.status).toBe('stopped')
    expect(await getDetachedBackgroundTask(storageDir, record.id)).toMatchObject({ status: 'stopped' })
  })

  it('settles the task once nothing of its work remains', async () => {
    await useFakeProbe('"ProcessId","ParentProcessId"\n"999999","@PPID@"\n')
    const record = await startDetachedBackgroundTask({
      storageDir,
      command: orphanWorkerCommand,
      cwd: storageDir
    })
    lastWorkerPid = await waitForWorkerPid(record.logFile)

    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({ status: 'running' })

    // The escaped work ends and the table reads empty: the anchor leaves, and the completion the
    // runner observed finally lands.
    await writeFakeRows('"ProcessId","ParentProcessId"\n')
    await vi.waitFor(
      async () => {
        await expect(getDetachedBackgroundTask(storageDir, record.id)).resolves.toMatchObject({
          status: 'completed'
        })
      },
      { timeout: 10_000, interval: 100 }
    )
  })

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
