import { describe, expect, it } from 'vitest'

import { FILE_IPC_MAX_READ_CHUNK_BYTES, fileRequestSchemas } from '../file'

describe('file.read schema', () => {
  const input = fileRequestSchemas['file.read'].input
  const handle = { kind: 'path' as const, path: '/tmp/report.pdf' }

  it('accepts strict full and range read modes', () => {
    expect(input.safeParse({ handle, options: { mode: 'full', encoding: 'binary' } }).success).toBe(true)
    expect(input.safeParse({ handle, options: { mode: 'range', offset: 10, length: 20 } }).success).toBe(true)
  })

  it('rejects legacy, hybrid, and oversized range options', () => {
    expect(input.safeParse({ handle, options: { encoding: 'binary' } }).success).toBe(false)
    expect(
      input.safeParse({ handle, options: { mode: 'full', encoding: 'binary', offset: 10, length: 20 } }).success
    ).toBe(false)
    expect(
      input.safeParse({ handle, options: { mode: 'range', encoding: 'binary', offset: 10, length: 20 } }).success
    ).toBe(false)
    expect(
      input.safeParse({
        handle,
        options: { mode: 'range', offset: 0, length: FILE_IPC_MAX_READ_CHUNK_BYTES + 1 }
      }).success
    ).toBe(false)
  })

  it('does not expose the former overlapping route', () => {
    expect('file.read_chunk' in fileRequestSchemas).toBe(false)
  })
})
