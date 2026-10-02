import type * as NodeFs from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileSyncMock } = vi.hoisted(() => ({ writeFileSyncMock: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<{ default: typeof NodeFs }>()).default,
  writeFileSync: writeFileSyncMock
}))

import { startDetachedBackgroundTask } from '../backgroundTasks'

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

  it.skipIf(process.platform === 'win32')('still records the task when the cleanup kill also fails', async () => {
    // The first record write fails, so the child is running untracked; the cleanup then fails too,
    // which is the Windows `taskkill` case. With no record the panel cannot see or stop it at all.
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })

    await expect(
      startDetachedBackgroundTask({
        storageDir,
        command: `${nodeBin} -e "setInterval(() => {}, 1000)"`,
        cwd: storageDir
      })
    ).rejects.toThrow()

    const records = (await readdir(storageDir)).filter((entry) => entry.endsWith('.json'))
    expect(records).toHaveLength(1)
  })
})
