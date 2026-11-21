import { describe, expect, it } from 'vitest'

import { isCustomStatusResult } from '../types'

describe('custom handler status results', () => {
  it('keeps an ordinary business object with a numeric status out of the response envelope', () => {
    expect(isCustomStatusResult({ status: 200, name: 'business status' })).toBe(false)
  })

  it.each([200, 201, 202, 204])('accepts an explicit data/status envelope with HTTP status %i', (status) => {
    expect(isCustomStatusResult({ status, data: { retained: true } })).toBe(true)
  })

  it('accepts an explicit empty response without requiring a truthy data value', () => {
    expect(isCustomStatusResult({ status: 204, data: undefined })).toBe(true)
    expect(isCustomStatusResult({ status: 200, data: null })).toBe(true)
    expect(isCustomStatusResult({ status: 200, data: false })).toBe(true)
  })

  it.each([null, undefined, 200, 'success', { status: '200', data: {} }, { status: 500, data: {} }])(
    'rejects non-envelopes and unsupported status values (%j)',
    (value) => {
      expect(isCustomStatusResult(value)).toBe(false)
    }
  )
})
