import { ContentHashSchema } from '@shared/data/types/file'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_ALGO, createContentHasher, hashContent, parseContentHash } from '../contentHash'

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
})
