import { xxh3 } from '@node-rs/xxhash'
import { describe, expect, it } from 'vitest'

import { ContentHashSchema } from '@shared/data/types/file'

import { CONTENT_HASH_ALGO, createContentHasher, hashContent, parseContentHash } from '../contentHash'
import { createXxh3_64FallbackHasher, xxh3_64Fallback } from '../xxh3Fallback'

const PRNG = Uint8Array.from([0x00, 0x52, 0x92, 0x9b, 0xb7, 0x32, 0xa3, 0x24])
const VECTORS: ReadonlyArray<{ len: number; hex: string }> = [
  { len: 0, hex: '2d06800538d394c2' },
  { len: 1, hex: 'c44bdff4074eecdb' },
  { len: 4, hex: 'e5dc74bc51848a51' },
  { len: 8, hex: '24ccc9acaa9f65e4' }
]

describe('contentHash', () => {
  it.each(VECTORS)('matches the canonical XXH3-64 vector for len=$len', ({ len, hex }) => {
    expect(hashContent(PRNG.subarray(0, len))).toBe(`${CONTENT_HASH_ALGO}:${hex}`)
  })

  it('hashes strings as their UTF-8 bytes', () => {
    expect(hashContent('hello')).toBe(hashContent(Buffer.from('hello', 'utf8')))
  })

  it('produces the same digest incrementally and one-shot across block boundaries', () => {
    const data = Uint8Array.from({ length: 5000 }, (_, index) => (index * 31 + 7) & 0xff)
    const hasher = createContentHasher()
    hasher.update(data.subarray(0, 100))
    hasher.update(data.subarray(100, 350))
    hasher.update(data.subarray(350, 1350))
    hasher.update(data.subarray(1350))

    expect(hasher.digest()).toBe(hashContent(data))
  })

  it('emits values accepted by ContentHashSchema', () => {
    expect(ContentHashSchema.safeParse(hashContent(PRNG)).success).toBe(true)
    expect(ContentHashSchema.safeParse(createContentHasher().digest()).success).toBe(true)
  })

  it('parses algorithm and digest components', () => {
    expect(parseContentHash('xxh3-64:24ccc9acaa9f65e4')).toEqual({
      algo: 'xxh3-64',
      hex: '24ccc9acaa9f65e4'
    })
    expect(parseContentHash('sha256-truncated:deadbeef00')).toEqual({
      algo: 'sha256-truncated',
      hex: 'deadbeef00'
    })
  })

  it.each([
    'xxh3-6424ccc9acaa9f65e4',
    ':24ccc9acaa9f65e4',
    'xxh3-64:',
    'XXH3-64:24ccc9acaa9f65e4',
    'xxh3-64:24CCC9ACAA9F65E4',
    'xxh3-64:24ccc9acaa9f65e4 ',
    ''
  ])('returns null for malformed input: %s', (value) => {
    expect(parseContentHash(value)).toBeNull()
  })

  it('produces bit-identical XXH3-64 digests between native @node-rs/xxhash and pure-TS fallback across all length regimes', () => {
    const buf = Uint8Array.from({ length: 4096 }, (_, index) => (index * 131 + 17) & 0xff)
    const testLengths = [
      0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 32, 33, 64, 65, 96, 97, 128, 129, 240, 241, 1024, 2048, 4096
    ]
    for (const len of testLengths) {
      const slice = buf.subarray(0, len)
      expect(xxh3_64Fallback(slice)).toBe(xxh3.xxh64(slice, 0n))
    }

    const fallbackHasher = createXxh3_64FallbackHasher()
    fallbackHasher.update(buf.subarray(0, 111))
    fallbackHasher.update(buf.subarray(111, 999))
    fallbackHasher.update(buf.subarray(999))
    expect(fallbackHasher.digest()).toBe(xxh3.xxh64(buf, 0n))
  })
})
