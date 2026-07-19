import { describe, expect, it } from 'vitest'

import { payloadLengthProfileSchema, type PayloadProfileDescriptor } from '../migrationDiagnosticsSchemas'
import { profilePayloadLengths } from '../payloadLengthProfiler'

const messageContent = { target: 'message', fields: ['content'] } as const satisfies PayloadProfileDescriptor

describe('profilePayloadLengths', () => {
  it('profiles UTF-8 string character and byte buckets', () => {
    expect(profilePayloadLengths([{ content: '你a' }], messageContent)).toEqual({
      target: 'message',
      rowCountBucket: '1',
      profiledByteLengthBucket: '1-256',
      maxProfiledRowByteLengthBucket: '1-256',
      traversal: 'complete',
      slots: [
        {
          slot: 'content',
          kind: 'string',
          totalByteLengthBucket: '1-256',
          maxCharLengthBucket: '1-256',
          maxByteLengthBucket: '1-256'
        }
      ]
    })
  })

  it('profiles Buffer and Uint8Array byte lengths without values', () => {
    const result = profilePayloadLengths(
      [{ content: Buffer.alloc(300) }, { content: new Uint8Array(10) }],
      messageContent
    )

    expect(result.slots).toEqual([
      {
        slot: 'content',
        kind: 'bytes',
        totalByteLengthBucket: '257-4096',
        maxByteLengthBucket: '257-4096'
      }
    ])
    expect(result.profiledByteLengthBucket).toBe('257-4096')
  })

  it('profiles JSON aggregate size and largest string leaf without emitting nested keys or values', () => {
    const result = profilePayloadLengths([{ metadata: { secretDynamicKey: '你好', nested: ['public-value'] } }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.slots[0]).toMatchObject({
      slot: 'metadata',
      kind: 'json',
      totalSerializedByteLengthBucket: '1-256',
      maxSerializedByteLengthBucket: '1-256',
      maxStringLeafCharLengthBucket: '1-256',
      maxStringLeafByteLengthBucket: '1-256',
      traversal: 'complete'
    })
    expect(JSON.stringify(result)).not.toContain('secretDynamicKey')
    expect(JSON.stringify(result)).not.toContain('public-value')
    expect(payloadLengthProfileSchema.safeParse(result).success).toBe(true)
  })

  it.each([
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      }
    ],
    [
      'depth',
      () => {
        let value: Record<string, unknown> = {}
        const root = value
        for (let index = 0; index < 10; index++) {
          value.next = {}
          value = value.next as Record<string, unknown>
        }
        return root
      }
    ],
    ['node budget', () => Array.from({ length: 1_100 }, (_, index) => index)]
  ] as const)('marks JSON %s truncation', (_name, makeValue) => {
    const result = profilePayloadLengths([{ metadata: makeValue() }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.traversal).toBe('truncated')
    expect(result.slots[0]).toMatchObject({ kind: 'json', traversal: 'truncated' })
  })

  it('honors the traversal deadline', () => {
    const largeLeaf = '你'.repeat(500_000)
    const result = profilePayloadLengths([{ metadata: Array(100).fill(largeLeaf) }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.traversal).toBe('truncated')
  })

  it('skips accessors without executing them', () => {
    let getterCalls = 0
    const row = Object.defineProperty({}, 'content', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'secret'
      }
    })

    const result = profilePayloadLengths([row], messageContent)

    expect(getterCalls).toBe(0)
    expect(result.slots).toEqual([{ slot: 'content', kind: 'empty' }])
  })

  it('marks unknown and non-plain values as unsupported', () => {
    const result = profilePayloadLengths([{ metadata: new Date() }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.slots).toEqual([{ slot: 'metadata', kind: 'unsupported' }])
  })

  it('marks a slot containing multiple supported kinds as mixed', () => {
    const result = profilePayloadLengths([{ content: 'text' }, { content: Buffer.alloc(4) }], messageContent)

    expect(result.slots).toEqual([{ slot: 'content', kind: 'mixed', traversal: 'complete' }])
  })

  it('caps descriptor fields without emitting unknown slots', () => {
    const fields = Array.from({ length: 65 }, () => 'content') as PayloadProfileDescriptor['fields']
    const result = profilePayloadLengths([{ content: 'text' }], { target: 'message', fields })

    expect(result.traversal).toBe('truncated')
    expect(result.slots).toEqual([
      {
        slot: 'content',
        kind: 'string',
        totalByteLengthBucket: '1-256',
        maxCharLengthBucket: '1-256',
        maxByteLengthBucket: '1-256'
      }
    ])
  })

  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-10'],
    [11, '11-100'],
    [101, '101-1000'],
    [1_001, '1001+']
  ] as const)('maps %i rows to %s', (count, bucket) => {
    expect(profilePayloadLengths(Array(count).fill(null), messageContent).rowCountBucket).toBe(bucket)
  })
})
