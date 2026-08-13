import { describe, expect, it, vi } from 'vitest'

// `estimateTokenCount` lives in messages.ts, which imports the heavy
// proxyStream module (pulls in @application / @logger / streamManager) at load.
// Stub it so importing the pure estimator stays lightweight.
vi.mock('../../proxyStream', () => ({
  processMessage: vi.fn(),
  default: { processMessage: vi.fn() }
}))

import { estimateTokenCount } from '../messages'

const base64Image = (len: number) =>
  ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'a'.repeat(len) }
  }) as const

describe('estimateTokenCount', () => {
  it('counts base64 images nested inside tool_result content (regression for #17079)', () => {
    const withImage = estimateTokenCount({
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [base64Image(10_000)] }] }
      ]
    })
    const withoutImage = estimateTokenCount({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [] }] }]
    })

    // Before the fix the nested image contributed zero tokens; it must now be
    // estimated the same as a top-level base64 image: floor(len * 0.75 / 100).
    expect(withImage - withoutImage).toBe(Math.floor((10_000 * 0.75) / 100))
    expect(withImage).toBeGreaterThan(withoutImage)
  })

  it('estimates a tool_result image the same as an equivalent top-level image', () => {
    const img = base64Image(8_000)
    const nested = estimateTokenCount({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [img] }] }]
    })
    const topLevel = estimateTokenCount({ messages: [{ role: 'user', content: [img] }] })

    // A tool_result carries a fixed +10 overhead that a bare image block does
    // not, so the media contribution should match once that offset is removed.
    expect(nested - 10).toBe(topLevel)
  })

  it('falls back to a fixed estimate for a non-base64 nested image', () => {
    const count = estimateTokenCount({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } }]
            }
          ]
        }
      ]
    })

    // url-image fallback (1000) + tool_result overhead (10) + message overhead (3).
    expect(count).toBe(1013)
  })
})
