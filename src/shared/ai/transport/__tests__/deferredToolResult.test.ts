import { describe, expect, it } from 'vitest'

import { isDeferredToolOutput } from '../deferredToolResult'

const ref = { topicId: 'topic-1', messageId: 'message-1', toolCallId: 'call-1', revision: 'r1' }
const excerpt = { head: 'head', tail: 'tail', totalChars: 100, totalLines: 10 }

describe('isDeferredToolOutput', () => {
  it('accepts references with optional excerpts and opaque payloads', () => {
    const skeleton = { nested: { keep: true } }
    const value = { $deferredToolResult: ref, excerpt, skeleton, extra: Symbol('opaque') }

    expect(isDeferredToolOutput(value)).toBe(true)
    expect(isDeferredToolOutput({ $deferredToolResult: ref })).toBe(true)
  })

  it('does not interpret unrelated extension properties', () => {
    const value = Object.defineProperty({ $deferredToolResult: ref }, 'extra', {
      enumerable: true,
      get() {
        throw new Error('opaque extension')
      }
    })

    expect(isDeferredToolOutput(value)).toBe(true)
  })

  it.each([
    null,
    { $deferredToolResult: [] },
    { $deferredToolResult: { ...ref, topicId: '' } },
    { $deferredToolResult: { ...ref, revision: 42 } },
    { $deferredToolResult: ref, excerpt: {} },
    { $deferredToolResult: ref, excerpt: { ...excerpt, tail: null } },
    { $deferredToolResult: ref, excerpt: { ...excerpt, totalLines: '10' } }
  ])('does not certify an incomplete or malformed envelope %#', (value) => {
    expect(isDeferredToolOutput(value)).toBe(false)
  })

  it('rejects an unreadable reference without throwing', () => {
    const value = Object.defineProperty({}, '$deferredToolResult', {
      get() {
        throw new Error('unreadable marker')
      }
    })

    expect(isDeferredToolOutput(value)).toBe(false)
  })
})
