import { describe, expect, it } from 'vitest'

import { fileToDataUrl, isTerminalHttpStatus } from '../transportUtils'

describe('isTerminalHttpStatus', () => {
  it('classifies 4xx (except 429) as terminal', () => {
    expect(isTerminalHttpStatus(400)).toBe(true)
    expect(isTerminalHttpStatus(401)).toBe(true)
    expect(isTerminalHttpStatus(404)).toBe(true)
    expect(isTerminalHttpStatus(422)).toBe(true)
    expect(isTerminalHttpStatus(499)).toBe(true)
  })

  it('classifies 429 and 5xx as transient (retryable)', () => {
    expect(isTerminalHttpStatus(429)).toBe(false)
    expect(isTerminalHttpStatus(500)).toBe(false)
    expect(isTerminalHttpStatus(502)).toBe(false)
    expect(isTerminalHttpStatus(503)).toBe(false)
  })

  it('treats 2xx/3xx as non-terminal', () => {
    expect(isTerminalHttpStatus(200)).toBe(false)
    expect(isTerminalHttpStatus(304)).toBe(false)
  })
})

describe('fileToDataUrl', () => {
  it('passes a url-typed file through unchanged', () => {
    expect(fileToDataUrl({ type: 'url', url: 'https://x/a.png' } as never)).toBe('https://x/a.png')
  })

  it('keeps an already-formed data URL string unchanged', () => {
    expect(fileToDataUrl({ mediaType: 'image/png', data: 'data:image/png;base64,AQID' } as never)).toBe(
      'data:image/png;base64,AQID'
    )
  })

  it('wraps raw base64 with the supplied mediaType', () => {
    expect(fileToDataUrl({ mediaType: 'image/jpeg', data: 'AQID' } as never)).toBe('data:image/jpeg;base64,AQID')
  })

  it('encodes Uint8Array bytes to a base64 data URL', () => {
    expect(fileToDataUrl({ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) } as never)).toBe(
      'data:image/png;base64,AQID'
    )
  })
})
