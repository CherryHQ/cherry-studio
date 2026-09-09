import { describe, expect, it } from 'vitest'

import { fileToDataUrl } from '../transportUtils'

describe('fileToDataUrl', () => {
  it('passes a url-typed file through unchanged', () => {
    expect(fileToDataUrl({ type: 'url', url: 'https://x/a.png' })).toBe('https://x/a.png')
  })

  it('keeps an already-formed data URL string unchanged', () => {
    expect(fileToDataUrl({ type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AQID' })).toBe(
      'data:image/png;base64,AQID'
    )
  })

  it('wraps raw base64 with the supplied mediaType', () => {
    expect(fileToDataUrl({ type: 'file', mediaType: 'image/jpeg', data: 'AQID' })).toBe('data:image/jpeg;base64,AQID')
  })

  it('encodes Uint8Array bytes to a base64 data URL', () => {
    expect(fileToDataUrl({ type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) })).toBe(
      'data:image/png;base64,AQID'
    )
  })
})
