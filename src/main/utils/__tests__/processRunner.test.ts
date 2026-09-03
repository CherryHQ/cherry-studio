import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { executeCommand, waitForProcessExit } from '../processRunner'

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

describe('waitForProcessExit', () => {
  it('resolves when exit precedes stdio close', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }) as unknown as ChildProcess
    const exited = waitForProcessExit(child, 1000)

    child.emit('exit', 0, null)

    await expect(exited).resolves.toBe(true)
  })

  it('resolves immediately for an already-exited child', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null }) as unknown as ChildProcess

    await expect(waitForProcessExit(child, 1000)).resolves.toBe(true)
  })
})
