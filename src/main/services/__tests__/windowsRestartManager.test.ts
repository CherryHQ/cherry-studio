import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { canStopDatabaseProcess, listDatabaseProcesses, stopDatabaseProcess } from '../windowsRestartManager'

const owner = { pid: 1234, started: '123456', name: 'Cherry Studio', executable: 'C:\\Cherry Studio.exe' }
afterEach(() => vi.restoreAllMocks())

describe('database process termination boundary', () => {
  it('rejects the current process, external executables, and unknown executable paths', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true)
    vi.mocked(application.getPath).mockReturnValue(owner.executable)
    expect(canStopDatabaseProcess(owner)).toBe(true)
    for (const candidate of [
      { ...owner, pid: process.pid },
      { ...owner, executable: '' },
      { ...owner, executable: 'C:\\Python.exe' }
    ]) {
      expect(canStopDatabaseProcess(candidate)).toBe(false)
      await expect(stopDatabaseProcess('C:\\test.sqlite', candidate, true)).rejects.toThrow('Not a verified')
    }
  })

  it('never enables termination for development Electron instances', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(false)
    vi.mocked(application.getPath).mockReturnValue(owner.executable)
    expect(canStopDatabaseProcess(owner)).toBe(false)
  })
})

// Catches native struct/PowerShell incompatibility and stale-PID termination on Windows.
it.skipIf(process.platform !== 'win32')(
  'identifies a real file owner and refuses a changed process identity',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'database-owner-'))
    const database = path.join(directory, 'test.sqlite')
    await writeFile(database, 'test resource')
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('fs').openSync(process.argv[1], 'r+'); process.stdout.write('ready'); setInterval(() => {}, 1000)",
        database
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    try {
      await once(child.stdout, 'data')
      const owners = await listDatabaseProcesses(database)
      const owner = owners.find((entry) => entry.pid === child.pid)
      expect(owner).toBeDefined()
      expect(owners.some((entry) => entry.pid === process.pid)).toBe(false)
      vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true)
      vi.mocked(application.getPath).mockReturnValue(process.execPath)
      await expect(stopDatabaseProcess(database, { ...owner!, started: '1' }, true)).rejects.toThrow()
      expect(child.exitCode).toBeNull()
      const exited = once(child, 'exit')
      await stopDatabaseProcess(database, owner!, true)
      await exited
      expect(await listDatabaseProcesses(database)).toEqual([])
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  120_000
)
