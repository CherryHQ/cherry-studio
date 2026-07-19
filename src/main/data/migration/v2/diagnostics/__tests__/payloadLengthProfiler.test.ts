import { afterEach, describe, expect, it, vi } from 'vitest'

import { payloadLengthProfileSchema, type PayloadProfileDescriptor } from '../migrationDiagnosticsSchemas'
import { createPayloadByteLengthMeasurement, profilePayloadLengths } from '../payloadLengthProfiler'

const messageContent = { target: 'message', fields: ['content'] } as const satisfies PayloadProfileDescriptor

afterEach(() => {
  vi.restoreAllMocks()
})

describe('profilePayloadLengths', () => {
  it('profiles UTF-8 string character and byte buckets', () => {
    expect(profilePayloadLengths([{ content: '你'.repeat(100) }], messageContent)).toEqual({
      target: 'message',
      rowCountBucket: '1',
      profiledByteLengthBucket: '257-4096',
      maxProfiledRowByteLengthBucket: '257-4096',
      traversal: 'complete',
      slots: [
        {
          slot: 'content',
          kind: 'string',
          totalByteLengthBucket: '257-4096',
          maxCharLengthBucket: '1-256',
          maxByteLengthBucket: '257-4096'
        }
      ]
    })
  })

  it('profiles Buffer and Uint8Array byte lengths without values', () => {
    const result = profilePayloadLengths(
      [{ content: Buffer.alloc(250) }, { content: new Uint8Array(300) }],
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
    expect(result.maxProfiledRowByteLengthBucket).toBe('257-4096')
  })

  it('profiles an opaque byte-length measurement without carrying or allocating payload bytes', () => {
    const measurement = createPayloadByteLengthMeasurement(300_000)
    const descriptor = {
      target: 'knowledge_vector_rebuild',
      fields: ['vectorBlob']
    } as const satisfies PayloadProfileDescriptor

    expect(Reflect.ownKeys(measurement)).toEqual([])
    expect(ArrayBuffer.isView(measurement)).toBe(false)
    expect(measurement).not.toBeInstanceOf(ArrayBuffer)
    expect(JSON.stringify(measurement)).toBe('{}')
    expect(profilePayloadLengths([{ vectorBlob: measurement }], descriptor)).toEqual({
      target: 'knowledge_vector_rebuild',
      rowCountBucket: '1',
      profiledByteLengthBucket: '262145+',
      maxProfiledRowByteLengthBucket: '262145+',
      traversal: 'complete',
      slots: [
        {
          slot: 'vectorBlob',
          kind: 'bytes',
          totalByteLengthBucket: '262145+',
          maxByteLengthBucket: '262145+'
        }
      ]
    })
  })

  it('reads each sampled lazy row at most once across both passes', () => {
    const getRow = vi.fn((index: number) => ({ content: `row-${index}` }))
    const rows = { length: 2, getRow }

    const result = profilePayloadLengths(rows, messageContent)

    expect(getRow).toHaveBeenCalledTimes(2)
    expect(getRow.mock.calls.map(([index]) => index)).toEqual([0, 1])
    expect(result).toMatchObject({ rowCountBucket: '2-10', traversal: 'complete' })
  })

  it('checks the deadline before reading another lazy row', () => {
    let clockReads = 0
    vi.spyOn(performance, 'now').mockImplementation(() => [0, 0, 6][clockReads++] ?? 6)
    const getRow = vi.fn((index: number) => ({ content: `row-${index}` }))

    const result = profilePayloadLengths({ length: 10_000, getRow }, messageContent)

    expect(getRow).toHaveBeenCalledTimes(1)
    expect(result.rowCountBucket).toBe('1001+')
    expect(result.traversal).toBe('truncated')
  })

  it.each([-1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'saturates anomalous opaque byte length %s and marks the profile truncated',
    (byteLength) => {
      const measurement = createPayloadByteLengthMeasurement(byteLength)
      const result = profilePayloadLengths([{ vectorBlob: measurement }], {
        target: 'knowledge_vector_rebuild',
        fields: ['vectorBlob']
      } as PayloadProfileDescriptor)

      expect(result).toMatchObject({
        profiledByteLengthBucket: '262145+',
        maxProfiledRowByteLengthBucket: '262145+',
        traversal: 'truncated',
        slots: [
          {
            slot: 'vectorBlob',
            kind: 'bytes',
            totalByteLengthBucket: '262145+',
            maxByteLengthBucket: '262145+'
          }
        ]
      })
    }
  )

  it.each([new Int16Array(300), new DataView(new ArrayBuffer(300))])(
    'marks non-Uint8Array views as unsupported',
    (view) => {
      const result = profilePayloadLengths([{ content: view }], messageContent)

      expect(result.profiledByteLengthBucket).toBe('0')
      expect(result.maxProfiledRowByteLengthBucket).toBe('0')
      expect(result.slots).toEqual([{ slot: 'content', kind: 'unsupported' }])
    }
  )

  it('reads Uint8Array length without invoking a hostile own accessor', () => {
    let getterCalls = 0
    const bytes = Object.defineProperty(new Uint8Array(300), 'byteLength', {
      get() {
        getterCalls += 1
        throw new Error('own byteLength getter executed')
      }
    })

    const result = profilePayloadLengths([{ content: bytes }], messageContent)

    expect(getterCalls).toBe(0)
    expect(result.profiledByteLengthBucket).toBe('257-4096')
    expect(result.maxProfiledRowByteLengthBucket).toBe('257-4096')
    expect(result.slots).toEqual([
      {
        slot: 'content',
        kind: 'bytes',
        totalByteLengthBucket: '257-4096',
        maxByteLengthBucket: '257-4096'
      }
    ])
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

  it('counts lone UTF-16 surrogates using well-formed JSON escaping', () => {
    const result = profilePayloadLengths([{ metadata: { value: '\ud800'.repeat(50) } }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.slots[0]).toMatchObject({
      kind: 'json',
      totalSerializedByteLengthBucket: '257-4096',
      maxSerializedByteLengthBucket: '257-4096',
      maxStringLeafCharLengthBucket: '1-256',
      maxStringLeafByteLengthBucket: '1-256'
    })
  })

  it('propagates unsupported nested JSON values to the global traversal', () => {
    const result = profilePayloadLengths([{ metadata: { missing: undefined } }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.traversal).toBe('truncated')
    expect(result.slots[0]).toMatchObject({ kind: 'json', traversal: 'truncated' })
  })

  it('keeps later JSON slot traversal local after an earlier slot is truncated', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const result = profilePayloadLengths([{ metadata: cyclic, content: { ok: 'x' } }], {
      target: 'message',
      fields: ['metadata', 'content']
    })

    expect(result.traversal).toBe('truncated')
    expect(result.slots).toEqual([
      expect.objectContaining({ slot: 'metadata', kind: 'json', traversal: 'truncated' }),
      expect.objectContaining({ slot: 'content', kind: 'json', traversal: 'complete' })
    ])
  })

  it('keeps JSON slot traversal local when only the descriptor field limit is exceeded', () => {
    const fields = Array.from({ length: 65 }, () => 'content') as PayloadProfileDescriptor['fields']
    const result = profilePayloadLengths([{ content: { ok: 'x' } }], { target: 'message', fields })

    expect(result.traversal).toBe('truncated')
    expect(result.slots).toEqual([expect.objectContaining({ slot: 'content', kind: 'json', traversal: 'complete' })])
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

  it('finds a trailing oversized string before spending the deadline on exact UTF-8 measurements', () => {
    const expensiveButBelowThreshold = '你'.repeat(65_536)
    const rows = [
      ...Array.from({ length: 128 }, () => ({ content: expensiveButBelowThreshold })),
      { content: 'x'.repeat(262_145) }
    ]

    const result = profilePayloadLengths(rows, messageContent)

    expect(result.traversal).toBe('truncated')
    expect(result.maxProfiledRowByteLengthBucket).toBe('262145+')
    expect(result.slots).toEqual([
      {
        slot: 'content',
        kind: 'string',
        totalByteLengthBucket: '262145+',
        maxCharLengthBucket: '262145+',
        maxByteLengthBucket: '262145+'
      }
    ])
  })

  it('checks the deadline before traversing plain-object properties', () => {
    let clockReads = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (++clockReads >= 5 ? 6 : 0))

    const result = profilePayloadLengths([{ metadata: { value: 'private' } }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(result.traversal).toBe('truncated')
    expect(result.slots[0]).toMatchObject({ kind: 'json', traversal: 'truncated' })
  })

  it('checks the deadline while skipping accessor properties without executing getters', () => {
    let clockReads = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (++clockReads >= 6 ? 6 : 0))
    let getterCalls = 0
    const metadata = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'private'
      }
    })

    const result = profilePayloadLengths([{ metadata }], {
      target: 'file_entry',
      fields: ['metadata']
    })

    expect(getterCalls).toBe(0)
    expect(result.traversal).toBe('truncated')
    expect(result.slots[0]).toMatchObject({ kind: 'json', traversal: 'truncated' })
  })

  it('bounds descriptor work for ultra-wide objects without snapshotting all property names', () => {
    let getterCalls = 0
    const metadata: Record<string, unknown> = {}
    Object.defineProperty(metadata, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'private'
      }
    })
    for (let index = 0; index < 10_000; index++) metadata[`wide${index}`] = index

    const descriptorSpy = vi.spyOn(Object, 'getOwnPropertyDescriptor')
    const propertyNamesSpy = vi.spyOn(Object, 'getOwnPropertyNames')
    const result = profilePayloadLengths([{ metadata }], {
      target: 'file_entry',
      fields: ['metadata']
    })
    const metadataDescriptorCalls = descriptorSpy.mock.calls.filter(([target]) => target === metadata).length

    expect(propertyNamesSpy).not.toHaveBeenCalled()
    expect(metadataDescriptorCalls).toBeLessThanOrEqual(1_024)
    expect(getterCalls).toBe(0)
    expect(result.traversal).toBe('truncated')
    expect(result.slots[0]).toMatchObject({ kind: 'json', traversal: 'truncated' })
  })

  it('ignores inherited enumerable pollution without executing its getter', () => {
    const descriptor = {
      target: 'file_entry',
      fields: ['metadata']
    } as const satisfies PayloadProfileDescriptor
    const baseline = profilePayloadLengths([{ metadata: { own: 'value' } }], descriptor)
    let getterCalls = 0
    let result: ReturnType<typeof profilePayloadLengths>

    Object.defineProperty(Object.prototype, '__payloadProfilerPollution__', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1
        return 'private'
      }
    })
    try {
      result = profilePayloadLengths([{ metadata: { own: 'value' } }], descriptor)
    } finally {
      Reflect.deleteProperty(Object.prototype, '__payloadProfilerPollution__')
    }

    expect(getterCalls).toBe(0)
    expect(result).toEqual(baseline)
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
