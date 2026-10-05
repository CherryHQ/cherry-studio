import type * as NodeFs from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileSyncMock } = vi.hoisted(() => ({ writeFileSyncMock: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeFs }>()).default,
  writeFileSync: writeFileSyncMock
}))

import {
  BACKGROUND_TASK_RECORD_EXT,
  type BackgroundTaskRecord,
  isPidAlive,
  listDetachedBackgroundTasks,
  startDetachedBackgroundTask,
  stopDetachedBackgroundTask
} from '../backgroundTasks'

const nodeBin = `"${process.execPath}"`

describe('a task whose record write fails', () => {
  let storageDir: string

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-untracked-'))
    const real = (await vi.importActual<typeof NodeFs>('node:fs')).writeFileSync
    let writes = 0
    writeFileSyncMock.mockImplementation((...args: unknown[]) => {
      writes += 1
      if (writes === 1) throw new Error('ENOSPC: no space left on device')
      return (real as unknown as (...a: unknown[]) => void)(...args)
    })
  })

  afterEach(async () => {
    writeFileSyncMock.mockReset()
    await rm(storageDir, { recursive: true, force: true })
  })

  // The recovery record read straight off disk. `listDetachedBackgroundTasks` reconciles, and a pid
  // that has already exited folds to `unknown`, so going through it races the task's own 50ms exit —
  // which is how a loaded runner came to assert `running` about a process that was gone.
  const readRecoveryRecord = async (): Promise<BackgroundTaskRecord> => {
    const [entry] = (await readdir(storageDir)).filter((name) => name.endsWith(BACKGROUND_TASK_RECORD_EXT))
    return JSON.parse(await readFile(path.join(storageDir, entry), 'utf8'))
  }

  it.skipIf(process.platform === 'win32')(
    'records the task so it stays stoppable when the cleanup kill also fails',
    async () => {
      // The first record write fails, so the child is running untracked; the cleanup then fails too,
      // which is the Windows `taskkill` case. The record written afterwards is the only handle on a
      // process nobody is tracking, so it has to be one every control path — including the sweep a
      // permanent agent deletion runs — still accepts.
      const realKill = process.kill.bind(process)
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH')
      })

      await expect(
        startDetachedBackgroundTask({
          storageDir,
          command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
          cwd: storageDir
        })
      ).rejects.toThrow()
      killSpy.mockRestore()

      const [record] = await listDetachedBackgroundTasks(storageDir)
      try {
        expect(record.status).toBe('running')
        expect(isPidAlive(record.pid)).toBe(true)

        const stopped = await stopDetachedBackgroundTask(storageDir, record.id, true)
        expect(stopped?.status).toBe('stopped')
        await vi.waitFor(() => expect(isPidAlive(record.pid)).toBe(false), { timeout: 10_000 })
      } finally {
        try {
          if (isPidAlive(record.pid)) realKill(-record.pid, 'SIGKILL')
        } catch {
          // already reaped
        }
      }
    }
  )

  it.skipIf(process.platform === 'win32')('stops claiming the pid once a recovered task exits on its own', async () => {
    // The record the recovery path writes is the only handle on this task, and it stays
    // stoppable only while the app still owns the pid in memory. Once the task exits that
    // ownership has to go with it — the OS is free to hand the same pid to something else, and a
    // stop that still believed the pid was ours would signal that unrelated process.
    const killFailSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    await expect(
      startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setTimeout(() => {}, 50)"`,
        cwd: storageDir
      })
    ).rejects.toThrow()
    killFailSpy.mockRestore()

    const record = await readRecoveryRecord()
    expect(record.status).toBe('running')
    await vi.waitFor(() => expect(isPidAlive(record.pid)).toBe(false), { timeout: 10_000 })

    // The pid is free for the OS to hand to something else now, so present it as taken: a stop
    // that still believed the pid was this task's would aim a signal at that other process.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    })
    try {
      await stopDetachedBackgroundTask(storageDir, record.id, true)
      expect(killSpy.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([])
    } finally {
      killSpy.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32')('completes a recovered task that finishes on its own', async () => {
    // The recovery record is the only handle on this task and it reads `running`, so the
    // completion it owes must still land when the process exits. Suppressing it would leave the
    // record at `running` for a pid that is gone, and leave every channel that asked for a
    // notification waiting for one that never comes.
    const onExit = vi.fn()
    const killFailSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    await expect(
      startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setTimeout(() => {}, 50)"`,
        cwd: storageDir,
        onExit
      })
    ).rejects.toThrow()
    killFailSpy.mockRestore()

    const record = await readRecoveryRecord()
    expect(record.status).toBe('running')
    await vi.waitFor(() => expect(isPidAlive(record.pid)).toBe(false), { timeout: 10_000 })

    // Polled to a deadline rather than inside waitFor, so a regression reports the status it
    // settled on instead of a timeout with nothing to compare. It waits for `completed` itself
    // rather than for any change: a reconcile folds the dead pid to `unknown` in the gap before
    // the completion lands, and stopping there would be the regression this test exists for.
    const deadline = Date.now() + 10_000
    let settled = record
    while (settled.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      ;[settled] = await listDetachedBackgroundTasks(storageDir)
    }
    expect(settled.status).toBe('completed')
    expect(settled.exitCode).toBe(0)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit.mock.calls[0][0].summary).toContain(record.id)
  })

  it.skipIf(process.platform === 'win32')(
    'names the task that is still running when the record cannot be written at all',
    async () => {
      // Neither the kill nor the recovery write can succeed here, so the process outlives the
      // failed start. Reporting that as a plain failure is what invites the retry that runs the
      // same command a second time, so the error has to name what is still running.
      writeFileSyncMock.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH')
      })

      const started = startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir
      })
      const failure = await started.then(
        () => {
          throw new Error('expected the start to fail')
        },
        (error: Error) => error
      )
      killSpy.mockRestore()

      const running = /is still running \(pid (\d+)\)/.exec(failure.message)
      expect(failure.cause).toBeInstanceOf(Error)
      const pid = running ? Number(running[1]) : 0
      try {
        expect(running).not.toBeNull()
        expect(isPidAlive(pid)).toBe(true)
        expect(await listDetachedBackgroundTasks(storageDir)).toEqual([])
      } finally {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // already reaped
        }
      }
    }
  )
})
