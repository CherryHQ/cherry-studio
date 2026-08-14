import { describe, expect, it } from 'vitest'

import { deriveRootSpanId } from '../trace'

describe('deriveRootSpanId', () => {
  it('returns the first 16 hex chars of the trace id (the container trace root)', () => {
    expect(deriveRootSpanId('abcdef0123456789abcdef0123456789')).toBe('abcdef0123456789')
  })

  it('normalizes uppercase trace ids to lowercase', () => {
    expect(deriveRootSpanId('ABCDEF0123456789ABCDEF0123456789')).toBe('abcdef0123456789')
  })

  it('falls back to a non-zero span id when the head would be all-zero', () => {
    // A span id must be non-zero hex16, so an all-zero head cannot be used as-is.
    expect(deriveRootSpanId('0000000000000000ffffffffffffffff')).toBe('1111111111111111')
  })

  it('is deterministic — the same trace id always yields the same root span id', () => {
    const traceId = 'a1b2c3d4e5f60718a1b2c3d4e5f60718'
    expect(deriveRootSpanId(traceId)).toBe(deriveRootSpanId(traceId))
  })
})
