import { describe, expect, it } from 'vitest'

import type { TokenDialect } from '../dialect'
import { mediaTokensFor } from '../profiles'

const DIALECTS: TokenDialect[] = ['anthropic', 'openai', 'google', 'ollama']

describe('mediaTokensFor', () => {
  it('prices gemini audio at the documented 32 tokens/second', () => {
    expect(mediaTokensFor('google', 'audio', 100)).toBe(3_200)
  })

  it('prices gemini video at 258 tokens/second (1 fps × 258 per frame)', () => {
    expect(mediaTokensFor('google', 'video', 10)).toBe(2_580)
  })

  it('prices openai video at 170 tokens/second (~2 fps × 85 per low-fidelity frame)', () => {
    expect(mediaTokensFor('openai', 'video', 10)).toBe(1_700)
  })

  // The whole point of the module: cost tracks DURATION, never payload size. A 13 MB MP3 and
  // a 13 KB one of the same length must cost the same (#17837).
  it('scales linearly with duration', () => {
    expect(mediaTokensFor('google', 'audio', 600)).toBe(10 * mediaTokensFor('google', 'audio', 60))
  })

  it('reproduces the #17837 provider count from the real duration', () => {
    // The reported clip: 20,221 provider tokens. 20221/32 ≈ 632 s, so a 632 s probe should
    // land within a few percent of what the provider actually charged.
    const estimated = mediaTokensFor('google', 'audio', 632)
    expect(Math.abs(estimated - 20_221) / 20_221).toBeLessThan(0.05)
  })

  describe('bounded fallback when the duration is unknown', () => {
    it.each(DIALECTS)('%s: finite, positive, and far below a base64-as-text score', (dialect) => {
      for (const kind of ['audio', 'video'] as const) {
        const fallback = mediaTokensFor(dialect, kind)
        expect(Number.isFinite(fallback)).toBe(true)
        expect(fallback).toBeGreaterThan(0)
        // A 13 MB attachment scored as text was ~3.7M tokens; the fallback must not be in
        // that league or it would fire compaction on its own.
        expect(fallback).toBeLessThan(100_000)
      }
    })

    it.each(DIALECTS)('%s: a zero/negative/NaN duration falls back rather than collapsing to 0', (dialect) => {
      const fallback = mediaTokensFor(dialect, 'audio')
      expect(mediaTokensFor(dialect, 'audio', 0)).toBe(fallback)
      expect(mediaTokensFor(dialect, 'audio', -5)).toBe(fallback)
      expect(mediaTokensFor(dialect, 'audio', Number.NaN)).toBe(fallback)
    })
  })
})
