import { ContentHashSchema } from '@shared/data/types/file/essential'
import { describe, expect, it } from 'vitest'

import { CONTENT_HASH_ALGO, createContentHasher, hashContent, parseContentHash } from '../contentHash'

/**
 * Official XXH3-64 (seed 0) known-answer vectors from the canonical xxHash
 * sanity test data (`Cyan4973/xxHash` `tests/sanity_test_vectors.h`,
 * `XSUM_XXH3_testdata`). Inputs are the first N bytes of xxHash's documented
 * sanity PRNG buffer (`00 52 92 9b b7 32 a3 24 …`).
 *
 * These pin the hash to a cross-platform-stable, implementation-independent
 * value. Cross-device bit-identical output is a hard requirement (Cherry runs
 * on Win/mac/Linux × x64/arm64), so the test asserts CANONICAL outputs — not
 * whatever the locally-installed native binary happens to produce.
 */
const PRNG = Uint8Array.from([0x00, 0x52, 0x92, 0x9b, 0xb7, 0x32, 0xa3, 0x24])
const VECTORS: ReadonlyArray<{ len: number; hex: string }> = [
  { len: 0, hex: '2d06800538d394c2' },
  { len: 1, hex: 'c44bdff4074eecdb' },
  { len: 4, hex: 'e5dc74bc51848a51' },
  { len: 8, hex: '24ccc9acaa9f65e4' }
]

describe('contentHash', () => {
  describe('hashContent — canonical XXH3-64 vectors', () => {
    it.each(VECTORS)('len=$len → $hex', ({ len, hex }) => {
      expect(hashContent(PRNG.subarray(0, len))).toBe(`${CONTENT_HASH_ALGO}:${hex}`)
    })
  })

  it('tags with the algorithm prefix and pads to 16 hex chars', () => {
    const h = hashContent(new Uint8Array(0))
    expect(h.startsWith('xxh3-64:')).toBe(true)
    expect(h).toMatch(/^xxh3-64:[0-9a-f]{16}$/)
  })

  it('hashes a string as its UTF-8 bytes (string ≡ Buffer)', () => {
    expect(hashContent('hello')).toBe(hashContent(Buffer.from('hello', 'utf8')))
  })

  describe('createContentHasher (streaming) ≡ hashContent (one-shot)', () => {
    it('agrees over chunked input, matching the canonical len=8 vector', () => {
      const hasher = createContentHasher()
      // Feed the 8-byte vector in irregular chunks to exercise incremental state.
      hasher.update(PRNG.subarray(0, 3))
      hasher.update(PRNG.subarray(3, 5))
      hasher.update(PRNG.subarray(5, 8))
      const out = hasher.digest()
      expect(out).toBe(`${CONTENT_HASH_ALGO}:24ccc9acaa9f65e4`)
      expect(out).toBe(hashContent(PRNG.subarray(0, 8)))
    })

    it('empty stream matches the canonical empty vector', () => {
      expect(createContentHasher().digest()).toBe(`${CONTENT_HASH_ALGO}:2d06800538d394c2`)
    })

    it('agrees over a multi-block file fed in irregular chunks straddling the ~240B boundary', () => {
      // XXH3 switches internal processing at ~240-byte block boundaries; the
      // dedup correctness contract is that in-pipe streaming agrees with the
      // in-memory one-shot on REAL multi-block files, not just <240B inputs.
      // Deterministic 5000-byte buffer (no Math.random — reproducible).
      const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) & 0xff)
      const oneShot = hashContent(data)

      const hasher = createContentHasher()
      // Irregular chunks that cross the ~240-byte boundary in different places.
      hasher.update(data.subarray(0, 100))
      hasher.update(data.subarray(100, 350))
      hasher.update(data.subarray(350, 1350))
      hasher.update(data.subarray(1350))
      expect(hasher.digest()).toBe(oneShot)
    })

    it('string ≡ Uint8Array equivalence holds at multi-block size', () => {
      // A long ASCII string and its UTF-8 bytes must hash identically past the
      // ~240-byte block boundary too (string is hashed as its UTF-8 bytes).
      const text = 'a'.repeat(5000)
      expect(hashContent(text)).toBe(hashContent(Buffer.from(text, 'utf8')))
    })
  })

  describe('producer output satisfies ContentHashSchema', () => {
    // Locks the producer↔validator contract: anything hashContent /
    // createContentHasher emit must pass the reader's `{algo}:{hex}` regex, so
    // the two can never drift apart silently.
    it('hashContent output passes the validator', () => {
      expect(ContentHashSchema.safeParse(hashContent(PRNG)).success).toBe(true)
      expect(ContentHashSchema.safeParse(hashContent(new Uint8Array(0))).success).toBe(true)
    })

    it('createContentHasher digest passes the validator', () => {
      const hasher = createContentHasher()
      hasher.update(PRNG)
      expect(ContentHashSchema.safeParse(hasher.digest()).success).toBe(true)
      expect(ContentHashSchema.safeParse(createContentHasher().digest()).success).toBe(true)
    })
  })

  describe('parseContentHash', () => {
    it('round-trips a real hashContent output into { algo, hex }', () => {
      const parsed = parseContentHash(hashContent(PRNG.subarray(0, 8)))
      expect(parsed).toEqual({ algo: CONTENT_HASH_ALGO, hex: '24ccc9acaa9f65e4' })
      expect(parsed?.algo).toBe('xxh3-64')
      expect(parsed?.hex).toMatch(/^[0-9a-f]{16}$/)
    })

    it('recovers both parts from a value composed as `${algo}:${hex}`', () => {
      const algo = 'sha256-truncated'
      const hex = 'deadbeef00'
      expect(parseContentHash(`${algo}:${hex}`)).toEqual({ algo, hex })
    })

    it.each([
      ['no colon', 'xxh3-6424ccc9acaa9f65e4'],
      ['empty algo', ':24ccc9acaa9f65e4'],
      ['empty hex', 'xxh3-64:'],
      ['uppercase hex', 'xxh3-64:24CCC9ACAA9F65E4'],
      ['uppercase algo', 'XXH3-64:24ccc9acaa9f65e4'],
      ['trailing junk', 'xxh3-64:24ccc9acaa9f65e4 '],
      ['empty string', '']
    ])('returns null on malformed input: %s', (_label, value) => {
      expect(parseContentHash(value)).toBeNull()
    })
  })
})
