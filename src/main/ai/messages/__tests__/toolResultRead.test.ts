import { describe, expect, it } from 'vitest'

import {
  toolResultPreview,
  toolResultTextRange,
  TOOL_RESULT_PREVIEW_BYTES,
  TOOL_RESULT_RANGE_BYTES
} from '../toolResultRead'

describe('bounded latest result presentation', () => {
  it('bounds escaped multibyte previews and retains typed navigation identities', () => {
    const result = toolResultPreview({
      sessionId: 'session-1',
      url: 'https://example.test/preview',
      content: '\u0000😀'.repeat(100_000)
    })
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(TOOL_RESULT_PREVIEW_BYTES)
    expect(result.truncated).toBe(true)
    const normal = toolResultPreview({ sessionId: 'session-1', url: 'https://example.test/preview', content: 'small' })
    expect(normal).toEqual({
      status: 'ready',
      purpose: 'preview',
      output: { sessionId: 'session-1', url: 'https://example.test/preview', content: 'small' },
      truncated: false
    })
  })

  it('reassembles all serialized bytes across Unicode-safe bounded ranges', () => {
    const bytes = Buffer.from(JSON.stringify({ output: '汉😀é'.repeat(100_000) }))
    let cursor = 0
    let text = ''
    do {
      const range = toolResultTextRange(bytes.subarray(cursor), cursor)
      expect(range.status).toBe('ready')
      if (range.status !== 'ready' || range.purpose !== 'text-range') throw Error('Expected a range')
      expect(Buffer.byteLength(range.text)).toBeLessThanOrEqual(TOOL_RESULT_RANGE_BYTES)
      expect(range.text).not.toContain('\ufffd')
      text += range.text
      if (range.nextCursor === undefined) break
      expect(range.nextCursor).toBeGreaterThan(cursor)
      cursor = range.nextCursor
    } while (cursor < bytes.length)
    expect(text).toBe(bytes.toString('utf8'))
  })
})
