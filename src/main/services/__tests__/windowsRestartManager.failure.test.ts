import { app } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { application } from '@application'

import { stopDatabaseProcess } from '../windowsRestartManager'

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: vi.fn(async () => ({ stdout: '351' })) }) }
})
afterEach(() => vi.restoreAllMocks())

it('allows escalation after a refused normal exit but rejects a failed force exit', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true)
  const executable = 'C:\\Cherry Studio.exe'
  vi.mocked(application.getPath).mockReturnValue(executable)
  const owner = { pid: process.pid + 1, started: '1234', name: 'Cherry Studio', executable }
  await expect(stopDatabaseProcess('C:\\test.sqlite', owner, false)).resolves.toBeUndefined()
  await expect(stopDatabaseProcess('C:\\test.sqlite', owner, true)).rejects.toThrow('351')
})
