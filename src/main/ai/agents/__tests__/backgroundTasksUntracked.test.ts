import type * as NodeFs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileSyncMock } = vi.hoisted(() => ({ writeFileSyncMock: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeFs }>()).default,
  writeFileSync: writeFileSyncMock
}))

import {
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
