import { describe, expect, it } from 'vitest'

import { classifyImageOutput, passthroughImageDownload } from '../imageDownload'

describe('classifyImageOutput', () => {
  it('treats http(s) values as pass-through URLs', () => {
    expect(classifyImageOutput('https://cdn.example.com/a.png')).toEqual({
      type: 'url',
      url: 'https://cdn.example.com/a.png'
    })
    expect(classifyImageOutput('http://x/y.jpg')).toEqual({ type: 'url', url: 'http://x/y.jpg' })
  })

  it('strips a redundant data:<mediaType>;base64, prefix', () => {
    expect(classifyImageOutput('data:image/png;base64,QUJD')).toEqual({ type: 'base64', base64: 'QUJD' })
    expect(classifyImageOutput('data:image/jpeg;base64,Zm9v')).toEqual({ type: 'base64', base64: 'Zm9v' })
  })

  it('passes already-raw base64 through unchanged', () => {
    expect(classifyImageOutput('QUJDREVG')).toEqual({ type: 'base64', base64: 'QUJDREVG' })
  })
})

describe('passthroughImageDownload', () => {
  it('returns null per item so the SDK keeps original URLs', async () => {
    const result = await passthroughImageDownload([
      { url: new URL('https://a/1.png'), isUrlSupportedByModel: false },
      { url: new URL('https://a/2.png'), isUrlSupportedByModel: false }
    ])
    expect(result).toEqual([null, null])
  })
})
