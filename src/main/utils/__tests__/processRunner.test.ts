import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn() }))

import { executeCommand } from '../processRunner'

describe('executeCommand', () => {
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
