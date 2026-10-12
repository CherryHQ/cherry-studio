import { describe, expect, it } from 'vitest'

import { sandboxRequestSchemas } from '../sandbox'

describe('sandbox IPC boundary', () => {
  const input = sandboxRequestSchemas['sandbox.run'].input
  const valid = { code: 'console.log(42)', timeoutMs: 1000 }

  it('accepts bounded code without letting the renderer choose host capabilities', () => {
    expect(input.parse(valid)).toEqual(valid)
    for (const extra of [
      { ownerId: 'another-window' },
      { executable: 'cmd.exe' },
      { env: { NODE_OPTIONS: '--inspect' } },
      { filesystem: { write: ['C:\\'] } },
      { network: { mode: 'unrestricted' } }
    ])
      expect(input.safeParse({ ...valid, ...extra }).success).toBe(false)
  })

  it('rejects unbounded input and execution time', () => {
    for (const code of ['', 'a'.repeat(32769)]) expect(input.safeParse({ ...valid, code }).success).toBe(false)
    for (const timeoutMs of [0, -1, 30001, Infinity, 1.5])
      expect(input.safeParse({ ...valid, timeoutMs }).success).toBe(false)
  })

  it('does not accept a renderer-selected cancellation target', () => {
    expect(sandboxRequestSchemas['sandbox.stop'].input.safeParse({ ownerId: 'another-window' }).success).toBe(false)
  })
})
