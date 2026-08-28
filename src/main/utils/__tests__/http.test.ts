import { describe, expect, it } from 'vitest'

import { mergeHeaders } from '../http'

describe('mergeHeaders', () => {
  it('collapses case variants of the same header so the last writer wins', () => {
    const merged = mergeHeaders({ 'User-Agent': 'Copilot/1.0' }, { 'user-agent': 'MyAgent/1.0' })

    expect(Object.keys(merged)).toEqual(['user-agent'])
    expect(new Headers(merged).get('user-agent')).toBe('MyAgent/1.0')
  })

  it('lets a trailing part force a header back regardless of the casing a caller used', () => {
    const merged = mergeHeaders(
      { 'content-type': 'application/json' },
      { 'Content-Type': 'text/plain' },
      { 'content-type': 'application/json' }
    )

    expect(new Headers(merged).get('content-type')).toBe('application/json')
    expect(Object.keys(merged).filter((k) => k.toLowerCase() === 'content-type')).toHaveLength(1)
  })

  it('drops undefined values and skips absent parts', () => {
    const merged = mergeHeaders({ Authorization: 'Bearer k' }, undefined, { 'X-Api-Key': undefined })

    expect(merged.authorization).toBe('Bearer k')
    expect(Object.hasOwn(merged, 'x-api-key')).toBe(false)
  })
})
