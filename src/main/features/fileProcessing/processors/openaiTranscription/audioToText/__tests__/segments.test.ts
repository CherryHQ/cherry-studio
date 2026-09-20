import { describe, expect, it } from 'vitest'

import { extractTranscriptionSegments } from '../handler'

describe('extractTranscriptionSegments', () => {
  it('applies chunk time offsets to verbose_json segments', () => {
    const segments = extractTranscriptionSegments(
      {
        text: 'hello world',
        segments: [
          { start: 0.0, end: 1.5, text: ' hello' },
          { start: 1.5, end: 3.0, text: ' world' }
        ]
      },
      60_000
    )
    expect(segments).toEqual([
      { startMs: 60_000, endMs: 61_500, text: 'hello' },
      { startMs: 61_500, endMs: 63_000, text: 'world' }
    ])
  })

  it('returns empty for payloads without segments', () => {
    expect(extractTranscriptionSegments({ text: 'only text' }, 0)).toEqual([])
  })
})
