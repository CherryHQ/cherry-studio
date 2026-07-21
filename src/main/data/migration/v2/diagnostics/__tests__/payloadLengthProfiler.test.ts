import { describe, expect, it, vi } from 'vitest'

import { measureFailedWriteValuesBestEffort } from '../payloadLengthProfiler'

describe('measureFailedWriteValuesBestEffort', () => {
  it('measures UTF-8 string bytes only after the lazy producer runs', () => {
    const values = vi.fn(() => [{ role: 'text_value' as const, kind: 'string' as const, value: '中a' }])

    expect(measureFailedWriteValuesBestEffort(values)).toEqual({
      kind: 'failed_write',
      truncated: false,
      values: [
        {
          role: 'text_value',
          kind: 'string',
          byteLength: 4,
          byteLengthBucket: '1-256'
        }
      ]
    })
    expect(values).toHaveBeenCalledOnce()
  })

  it('uses JSON.stringify only on failure-owned values and records no serialized content', () => {
    const value = { nested: 'PRIVATE_JSON_CANARY' }
    const expectedLength = Buffer.byteLength(JSON.stringify(value), 'utf8')
    const result = measureFailedWriteValuesBestEffort(() => [{ role: 'json_value', kind: 'json', value }])

    expect(result).toEqual({
      kind: 'failed_write',
      truncated: false,
      values: [
        {
          role: 'json_value',
          kind: 'json',
          byteLength: expectedLength,
          byteLengthBucket: '1-256'
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_JSON_CANARY')
  })

  it('returns at most three fixed measurements and marks a longer candidate set as truncated', () => {
    const result = measureFailedWriteValuesBestEffort(() => [
      { role: 'text_value', kind: 'string', value: 'a' },
      { role: 'json_value', kind: 'json', value: { a: 1 } },
      { role: 'text_value', kind: 'string', value: 'b' },
      { role: 'text_value', kind: 'string', value: 'ignored' }
    ])

    expect(result?.values).toHaveLength(3)
    expect(result?.truncated).toBe(true)
  })

  it.each([
    () => {
      throw new Error('PRIVATE_PRODUCER_CANARY')
    },
    () => [
      {
        role: 'json_value' as const,
        kind: 'json' as const,
        value: {
          toJSON() {
            throw new Error('PRIVATE_STRINGIFY_CANARY')
          }
        }
      }
    ]
  ])('omits all evidence when best-effort measurement throws', (values) => {
    expect(measureFailedWriteValuesBestEffort(values)).toBeUndefined()
  })
})
