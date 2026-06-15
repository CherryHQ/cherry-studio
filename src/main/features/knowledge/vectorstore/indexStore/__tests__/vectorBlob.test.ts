import { describe, expect, it } from 'vitest'

import { encodeVectorBlob } from '../vectorBlob'

describe('encodeVectorBlob', () => {
  it('encodes little-endian float32, 4 bytes per value', () => {
    const blob = encodeVectorBlob([1, 2, 3])
    expect(blob.byteLength).toBe(12)

    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    expect(view.getFloat32(0, true)).toBeCloseTo(1)
    expect(view.getFloat32(4, true)).toBeCloseTo(2)
    expect(view.getFloat32(8, true)).toBeCloseTo(3)
  })

  it('produces an empty blob for an empty vector', () => {
    expect(encodeVectorBlob([]).byteLength).toBe(0)
  })

  it('emits the exact little-endian float32 bytes (cross-engine canonical format)', () => {
    // IEEE-754 float32: 1.0 = 0x3F800000, 0.5 = 0x3F000000, -2.0 = 0xC0000000,
    // each stored little-endian (least-significant byte first).
    expect(Array.from(encodeVectorBlob([1, 0.5, -2]))).toEqual([
      0x00, 0x00, 0x80, 0x3f, 0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x00, 0xc0
    ])
  })
})
