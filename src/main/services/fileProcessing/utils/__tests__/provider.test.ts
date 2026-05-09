import { describe, expect, it } from 'vitest'

import { assertHasFilePath, getApiKey, getRequiredApiHost, getRequiredApiKey } from '../provider'

describe('file processing provider utils', () => {
  it('rejects files without a path', () => {
    expect(() => assertHasFilePath({ path: '' })).toThrowError('File path is required')
    expect(() => assertHasFilePath({ path: undefined })).toThrowError('File path is required')
  })

  it('returns a trimmed api host and strips trailing slashes', () => {
    expect(
      getRequiredApiHost({
        apiHost: '  https://api.example.com/path  '
      } as never)
    ).toBe('https://api.example.com/path')

    expect(
      getRequiredApiHost({
        apiHost: 'https://api.example.com///'
      } as never)
    ).toBe('https://api.example.com')
  })

  it('rejects missing api hosts', () => {
    expect(() => getRequiredApiHost({ apiHost: '   ' } as never)).toThrowError('API host is required')
    expect(() => getRequiredApiHost({ apiHost: undefined } as never)).toThrowError('API host is required')
  })

  it('returns a required api key and rejects empty key lists', () => {
    expect(
      getRequiredApiKey(
        {
          apiKeys: ['  secret-key  ']
        } as never,
        'doc2x'
      )
    ).toBe('secret-key')

    expect(() =>
      getRequiredApiKey(
        {
          apiKeys: []
        } as never,
        'doc2x'
      )
    ).toThrowError('API key is required')
  })

  it('rotates multiple api keys per processor and skips blank entries', () => {
    const config = {
      apiKeys: [' key-a ', '', 'key-b']
    } as never

    expect(getApiKey(config, 'doc2x')).toBe('key-a')
    expect(getApiKey(config, 'doc2x')).toBe('key-b')
    expect(getApiKey(config, 'doc2x')).toBe('key-a')

    expect(getApiKey(config, 'mineru')).toBe('key-a')
    expect(getApiKey(config, 'doc2x')).toBe('key-b')
    expect(getApiKey(config, 'mineru')).toBe('key-b')
  })
})
