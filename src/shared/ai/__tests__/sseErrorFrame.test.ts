/**
 * A quota failure must surface as a structured error whose text is the provider's
 * own message — never the SSE frame the provider happened to deliver it on.
 */

import { describe, expect, it } from 'vitest'

import { extractSseErrorFrame } from '../sseErrorFrame'

const OPENAI_FRAME =
  'API Error: Request rejected (429) · event:error data:{"type":"error","error":{"type":"rate_limit_error","message":"You exceeded your current quota."}}'

describe('extractSseErrorFrame', () => {
  it("recovers the provider's message instead of the raw frame", () => {
    expect(extractSseErrorFrame(OPENAI_FRAME)?.message).toBe('You exceeded your current quota.')
  })

  it('recovers the structured type and status the frame carries', () => {
    const frame = extractSseErrorFrame(OPENAI_FRAME)
    expect(frame?.type).toBe('rate_limit_error')
    expect(frame?.statusCode).toBe(429)
  })

  it('reads the Anthropic-shaped named-event frame', () => {
    const anthropic =
      'Request rejected (429) · event: error\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your quota."}}\n\n'
    const frame = extractSseErrorFrame(anthropic)
    expect(frame?.message).toBe('Number of request tokens has exceeded your quota.')
    expect(frame?.statusCode).toBe(429)
  })

  it('reads the status carried inside the payload when prose has none', () => {
    expect(
      extractSseErrorFrame('data: {"error":{"type":"overloaded_error","message":"Overloaded","status":529}}')
        ?.statusCode
    ).toBe(529)
  })

  it('returns undefined for plain prose, so callers keep their original text', () => {
    expect(extractSseErrorFrame('Provider request failed with status 429 Too Many Requests')).toBeUndefined()
  })

  it('returns undefined when the frame is not valid JSON', () => {
    expect(extractSseErrorFrame('API Error: data: {oops')).toBeUndefined()
  })

  it('returns undefined when the frame carries no usable field', () => {
    expect(extractSseErrorFrame('data: {"foo":1}')).toBeUndefined()
  })
})
