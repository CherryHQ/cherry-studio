import { describe, expect, it } from 'vitest'

import { getApiKey, getRequiredApiHost, getRequiredApiKey } from '../provider'

describe('file processing provider utils', () => {
  it('returns a trimmed api host and strips trailing slashes', () => {
    expect(
      getRequiredApiHost({
        apiHost: '  https://api.example.com/path  '
      })
    ).toBe('https://api.example.com/path')

    expect(
      getRequiredApiHost({
        apiHost: 'https://api.example.com///'
      })
    ).toBe('https://api.example.com')
  })

  it('rejects missing api hosts', () => {
    expect(() => getRequiredApiHost({ apiHost: '   ' })).toThrowError('API host is required')
    expect(() => getRequiredApiHost({ apiHost: undefined })).toThrowError('API host is required')
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

  it('rotates over distinct keys when a key is configured twice', () => {
    const config = {
      apiKeys: ['KEY-A', 'KEY-A', 'KEY-B']
    } as never

    expect(getApiKey(config, 'rotate-distinct-duplicate')).toBe('KEY-A')
    expect(getApiKey(config, 'rotate-distinct-duplicate')).toBe('KEY-B')
    expect(getApiKey(config, 'rotate-distinct-duplicate')).toBe('KEY-A')
  })

  it('treats whitespace variants of the same key as one entry', () => {
    const config = {
      apiKeys: ['KEY-A', ' KEY-A ', 'KEY-B']
    } as never

    expect(getApiKey(config, 'rotate-distinct-whitespace')).toBe('KEY-A')
    expect(getApiKey(config, 'rotate-distinct-whitespace')).toBe('KEY-B')
    expect(getApiKey(config, 'rotate-distinct-whitespace')).toBe('KEY-A')
  })

  it('collapses all-identical keys to a single key', () => {
    const config = {
      apiKeys: ['KEY-A', 'KEY-A', 'KEY-A']
    } as never

    expect(getApiKey(config, 'rotate-distinct-identical')).toBe('KEY-A')
    expect(getApiKey(config, 'rotate-distinct-identical')).toBe('KEY-A')
    expect(getApiKey(config, 'rotate-distinct-identical')).toBe('KEY-A')
  })
})
