import type * as NodeChildProcess from 'node:child_process'
import type * as NodeFs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileSyncMock, execFileMock } = vi.hoisted(() => ({
  writeFileSyncMock: vi.fn(),
  // `taskkill` failing is its most common outcome: the process has already exited.
  execFileMock: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeFs }>()).default,
  writeFileSync: writeFileSyncMock
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeChildProcess }>()).default,
  execFile: execFileMock
}))

import { listDetachedBackgroundTasks, startDetachedBackgroundTask } from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`

describe('a Windows task whose record write fails', () => {
  let storageDir: string
  let realPlatform: NodeJS.Platform

  beforeEach(async () => {
    // The awaited `taskkill` is the only yield between the failed record write and the recovery
    // write, so only the Windows branch can have the child finish inside it.
    realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-untracked-win-'))
    const real = (await vi.importActual<typeof NodeFs>('node:fs')).writeFileSync
    let writes = 0
    writeFileSyncMock.mockImplementation((...args: unknown[]) => {
      writes += 1
      if (writes === 1) throw new Error('ENOSPC: no space left on device')
      return (real as unknown as (...a: unknown[]) => void)(...args)
    })
    // `taskkill` is a real process spawn, so it outlives a task that finishes quickly and then
    // reports the process it was asked to kill is already gone. The delay is what opens the window.
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void
      setTimeout(() => callback(new Error('ERROR: The process could not be terminated.')), 300)
    })
  })

  afterEach(async () => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    writeFileSyncMock.mockReset()
    execFileMock.mockReset()
    await rm(storageDir, { recursive: true, force: true })
  })

  it('does not tell the agent a task is still running when the same call published its completion', async () => {
    // The start reports failure to the agent, so its message is the signal that keeps the agent
    // from retrying a command that is still in flight. When this same call has already announced
    // the task finished, that message contradicts the notification and invites a poll for a task
    // that is done.
    const onExit = vi.fn()
    const failure = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setTimeout(() => {}, 50)"`,
      cwd: storageDir,
      onExit
    }).then(
      () => {
        throw new Error('expected the start to fail')
      },
      (error: Error) => error
    )

    const deadline = Date.now() + 10_000
    let [record] = await listDetachedBackgroundTasks(storageDir)
    while (record.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      ;[record] = await listDetachedBackgroundTasks(storageDir)
    }

    expect(record.status).toBe('completed')
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(failure.message).toContain('already finished')
    expect(failure.message).not.toMatch(/is still running/)
  })
})
