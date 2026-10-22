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

it('only accepts fixed diagnostic groups, never renderer-selected capabilities', () => {
  const schema = sandboxRequestSchemas['sandbox.diagnose'].input
  for (const group of ['files', 'rpc', 'instances', 'network']) expect(schema.safeParse({ group }).success).toBe(true)
  for (const input of [
    { group: 'arbitrary' },
    { group: 'network', url: 'http://internal/' },
    { group: 'files', path: '/' },
    { group: 'rpc', method: 'main.secret' }
  ])
    expect(schema.safeParse(input).success).toBe(false)
})

it('bounds interactive parameters and keeps executable, ownership and filesystem grants host-owned', () => {
  const schema = sandboxRequestSchemas['sandbox.request'].input
  expect(schema.parse({ kind: 'rpc', value: 7, allowCallback: false })).toEqual({
    kind: 'rpc',
    value: 7,
    allowCallback: false
  })
  expect(schema.safeParse({ kind: 'network', url: 'https://example.com/path?q=1', allowedOrigins: [] }).success).toBe(
    true
  )
  for (const input of [
    { kind: 'rpc', value: Infinity, allowCallback: true },
    { kind: 'rpc', value: 1000001, allowCallback: true },
    { kind: 'rpc', value: 1, allowCallback: true, method: 'host.secret' },
    { kind: 'network', url: 'not a URL', allowedOrigins: [] },
    { kind: 'network', url: 'file:///etc/passwd', allowedOrigins: [] },
    { kind: 'network', url: 'https://user:password@example.com', allowedOrigins: [] },
    { kind: 'network', url: 'https://example.com', allowedOrigins: ['https://example.com/path'] },
    { kind: 'network', url: 'https://example.com', allowedOrigins: Array(65).fill('https://example.com') },
    { kind: 'network', url: 'https://example.com', allowedOrigins: [], ownerId: 'other-window' },
    { kind: 'network', url: 'https://example.com', allowedOrigins: [], filesystem: { write: ['/'] } }
  ])
    expect(schema.safeParse(input).success).toBe(false)
})
