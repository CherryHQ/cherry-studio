import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { executeCommand } from '../processRunner'

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

  it('spawns despite NUL bytes in the caller-supplied env', async () => {
    // Node rejects the whole env ("must be a string without null bytes") from
    // normalizeSpawnArguments, before the subprocess starts — so a caller cannot
    // be trusted to hand over a spawnable env (#20344).
    await expect(
      executeCommand(process.execPath, printStdout, {
        env: { ...process.env, BROKEN: 'a\0b', Path: 'C:\\x\0y' }
      })
    ).resolves.toBe('command output')
  })
})
