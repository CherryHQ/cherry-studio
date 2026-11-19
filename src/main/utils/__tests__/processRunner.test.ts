import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { executeCommand, terminateProcessTree } from '../processRunner'

const printStdout = ['-e', "process.stdout.write('command output')"]

describe('executeCommand', () => {
  it('returns stdout when capture is omitted', async () => {
    await expect(executeCommand(process.execPath, printStdout, { env: process.env })).resolves.toBe('command output')
  })

  it('discards stdout when capture is explicitly disabled', async () => {
    await expect(executeCommand(process.execPath, printStdout, { capture: false, env: process.env })).resolves.toBe('')
  })

  it('terminates a command whose captured stdout exceeds the configured limit', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(64))"], {
        capture: true,
        env: process.env,
        maxOutputBytes: 16
      })
    ).rejects.toThrow('output exceeded 16 bytes')
  })
})

describe('terminateProcessTree', () => {
  it.skipIf(process.platform === 'win32')(
    'ignores a reclaimed process group only after the owned child has exited',
    async () => {
      const error = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw error
      })
      try {
        const child = Object.assign(new EventEmitter(), {
          pid: 12345,
          exitCode: 0,
          signalCode: null
        }) as ChildProcess
        await expect(terminateProcessTree(child, false, 'test')).resolves.toBeUndefined()
        Object.assign(child, { exitCode: null })
        await expect(terminateProcessTree(child, false, 'test')).rejects.toBe(error)
      } finally {
        kill.mockRestore()
      }
    }
  )
})
