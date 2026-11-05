import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { executeCommand } from '../processRunner'

/** Alive and not a zombie: an orphan reparented to a non-reaping init stays signalable after it died. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

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

  it('kills a running command and rejects when the signal aborts', async () => {
    const controller = new AbortController()
    const running = executeCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: process.env,
      signal: controller.signal
    })
    controller.abort(new Error('cancelled'))
    await expect(running).rejects.toThrow('cancelled')
  })

  it.skipIf(process.platform === 'win32')('terminates descendants of an aborted command before rejecting', async () => {
    const pidFile = path.join(os.tmpdir(), `process-runner-grandchild-${process.pid}-${Date.now()}.pid`)
    const script = [
      "const { spawn } = require('child_process')",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid))`,
      'setInterval(() => {}, 1000)'
    ].join(';')
    const controller = new AbortController()
    const running = executeCommand(process.execPath, ['-e', script], { env: process.env, signal: controller.signal })
    const rejection = expect(running).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true))
    await vi.waitFor(() => expect(fs.readFileSync(pidFile, 'utf8')).not.toBe(''))
    const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(() => process.kill(grandchildPid, 0)).not.toThrow()

    controller.abort(new Error('cancelled'))
    await rejection

    // Rejection means the tree is gone: the grandchild must already be dead, not merely signalled.
    expect(() => process.kill(grandchildPid, 0)).toThrow()
    fs.rmSync(pidFile, { force: true })
  })

  it('does not spawn when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      executeCommand(process.execPath, printStdout, { env: process.env, signal: controller.signal })
    ).rejects.toThrow('cancelled')
  })
})
