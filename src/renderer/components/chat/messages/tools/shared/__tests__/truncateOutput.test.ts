import { describe, expect, it } from 'vitest'

import { countLines, truncateOutput } from '../truncateOutput'

describe('truncateOutput', () => {
  it('returns an empty non-truncated result for empty values', () => {
    expect(truncateOutput(undefined)).toEqual({ data: '', isTruncated: false, originalLength: 0 })
    expect(truncateOutput(null)).toEqual({ data: '', isTruncated: false, originalLength: 0 })
    expect(truncateOutput('')).toEqual({ data: '', isTruncated: false, originalLength: 0 })
  })

  it('keeps short string output unchanged', () => {
    expect(truncateOutput('hello')).toEqual({ data: 'hello', isTruncated: false, originalLength: 5 })
  })

  it('joins text content items from tool result payloads', () => {
    expect(
      truncateOutput({
        content: [
          { type: 'text', text: 'first' },
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'second' }
        ]
      })
    ).toEqual({ data: 'first\n\nsecond', isTruncated: false, originalLength: 13 })
  })

  it('serializes object output when it does not contain text content items', () => {
    expect(truncateOutput({ ok: true, count: 2 })).toEqual({
      data: '{\n  "ok": true,\n  "count": 2\n}',
      isTruncated: false,
      originalLength: 30
    })
  })

  it('falls back to String for unserializable output', () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(truncateOutput(value)).toEqual({
      data: '[object Object]',
      isTruncated: false,
      originalLength: 15
    })
  })

  it('truncates at a nearby newline boundary', () => {
    expect(truncateOutput('123456789\nabcdef', 10)).toEqual({
      data: '123456789',
      isTruncated: true,
      originalLength: 16
    })
  })

  it('keeps the hard limit when the last newline is too far from the limit', () => {
    expect(truncateOutput('12\n34567890abcdef', 10)).toEqual({
      data: '12\n3456789',
      isTruncated: true,
      originalLength: 17
    })
  })
})

describe('countLines', () => {
  it('counts non-empty rendered output lines', () => {
    expect(countLines('one\n\n two \n   \nthree')).toBe(3)
  })

  it('counts text output items after joining them', () => {
    expect(countLines([{ type: 'text', text: 'one\n\ntwo' }])).toBe(2)
  })
})
