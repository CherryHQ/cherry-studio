import { describe, expect, it, vi } from 'vitest'

import { measureFailedWriteValuesBestEffort } from '../payloadLengthProfiler'

describe('measureFailedWriteValuesBestEffort', () => {
  it('measures UTF-8 string bytes only after the lazy producer runs', () => {
    const values = vi.fn(() => [{ role: 'text_value' as const, kind: 'string' as const, value: '中a' }])

    expect(measureFailedWriteValuesBestEffort(values, 'insert')).toEqual({
      kind: 'failed_write',
      operationRole: 'insert',
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
    const result = measureFailedWriteValuesBestEffort(() => [{ role: 'json_value', kind: 'json', value }], 'upsert')

    expect(result).toEqual({
      kind: 'failed_write',
      operationRole: 'upsert',
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

  it('reads only an existing blob byteLength number and never receives payload bytes', () => {
    expect(
      measureFailedWriteValuesBestEffort(
        () => [{ role: 'blob_value', kind: 'blob', byteLength: 65_537 }],
        'status_write'
      )
    ).toEqual({
      kind: 'failed_write',
      operationRole: 'status_write',
      truncated: false,
      values: [
        {
          role: 'blob_value',
          kind: 'blob',
          byteLength: 65_537,
          byteLengthBucket: '65537-262144'
        }
      ]
    })
  })

  it.each([262_145, Number.MAX_SAFE_INTEGER, -1, Number.NaN])(
    'saturates an out-of-range length %s at the schema ceiling',
    (byteLength) => {
      expect(
        measureFailedWriteValuesBestEffort(() => [{ role: 'blob_value', kind: 'blob', byteLength }], 'insert')
          ?.values[0]
      ).toEqual({
        role: 'blob_value',
        kind: 'blob',
        byteLength: 262_145,
        byteLengthBucket: '262145+'
      })
    }
  )

  it('returns at most three fixed measurements and marks a longer candidate set as truncated', () => {
    const result = measureFailedWriteValuesBestEffort(
      () => [
        { role: 'text_value', kind: 'string', value: 'a' },
        { role: 'json_value', kind: 'json', value: { a: 1 } },
        { role: 'blob_value', kind: 'blob', byteLength: 2 },
        { role: 'text_value', kind: 'string', value: 'ignored' }
      ],
      'insert'
    )

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
    expect(measureFailedWriteValuesBestEffort(values, 'insert')).toBeUndefined()
  })
})
