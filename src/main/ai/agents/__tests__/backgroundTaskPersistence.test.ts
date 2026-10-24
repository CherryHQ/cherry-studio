import type * as NodeFsPromises from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Chooses which durable write the next attempt destroys, the way a full disk does. */
const { failingWrite } = vi.hoisted(() => {
  const failingWrite: { kind: 'none' | 'record' | 'sentinel' } = { kind: 'none' }
  return { failingWrite }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    writeFile: async (file: never, data: never, options: never) => {
      const target = String(file)
      const doomed =
        (failingWrite.kind === 'record' && target.includes('.json')) ||
        (failingWrite.kind === 'sentinel' && target.endsWith('.done'))
      if (doomed) {
        // A short write followed by an error: the bytes that reached the disk are a prefix.
        await (actual.writeFile as unknown as (f: string, d: string) => Promise<void>)(
          target,
          String(data).slice(0, 12)
        )
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }
      return (actual.writeFile as unknown as (f: string, d: string, o: unknown) => Promise<void>)(
        target,
        String(data),
        options
      )
    }
  }
})

import { isPidAlive, startDetachedBackgroundTask, stopDetachedBackgroundTask } from '../backgroundTasks'

// Double quotes survive both POSIX sh and cmd.exe, including spaced paths.
const nodeBin = `"${process.execPath}"`

describe('background task durable writes', () => {
  let storageDir: string

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'cherry-bg-durable-'))
    failingWrite.kind = 'none'
  })

  afterEach(async () => {
    failingWrite.kind = 'none'
    await rm(storageDir, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('keeps the previous record when a rewrite cannot finish', async () => {
    const running = await startDetachedBackgroundTask({
      storageDir,
      command: `${nodeBin} -e "setInterval(() => {}, 30000)"`,
      cwd: storageDir
    })
    const recordPath = path.join(storageDir, `${running.id}.json`)

    try {
      // The stop writes its stop-requested record before it signals the process, so an interrupted
      // rewrite lands while the task is still alive. Truncating that record would leave a running
      // process with nothing on disk to find it by.
      failingWrite.kind = 'record'
      await expect(stopDetachedBackgroundTask(storageDir, running.id)).rejects.toThrow(/ENOSPC/)

      const surviving = JSON.parse(await readFile(recordPath, 'utf8')) as { status: string; stopRequestedAt?: string }
      expect(surviving.status).toBe('running')
      expect(surviving.stopRequestedAt).toBeUndefined()
      expect(isPidAlive(running.pid)).toBe(true)
    } finally {
      failingWrite.kind = 'none'
      await stopDetachedBackgroundTask(storageDir, running.id, true)
      await vi.waitFor(() => expect(isPidAlive(running.pid)).toBe(false), { timeout: 10_000 })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'still reports and announces a kill whose sentinel cannot be written',
    async () => {
      const running = await startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 30000)"`,
        cwd: storageDir
      })
      const onExit = vi.fn()

      try {
        // The kill ends the process with no exit event behind it, so the sentinel is the only thing
        // that can fail here — and neither the caller nor the configured channels may be left
        // believing the task is still running.
        failingWrite.kind = 'sentinel'
        const stopped = await stopDetachedBackgroundTask(storageDir, running.id, true, onExit)

        expect(stopped?.status).toBe('stopped')
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(onExit.mock.calls[0][0].record.id).toBe(running.id)
        await vi.waitFor(() => expect(isPidAlive(running.pid)).toBe(false), { timeout: 10_000 })
      } finally {
        failingWrite.kind = 'none'
        await vi.waitFor(() => expect(isPidAlive(running.pid)).toBe(false), { timeout: 10_000 })
      }
    }
  )
})
