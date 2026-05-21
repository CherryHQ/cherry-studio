import { describe, expect, it } from 'vitest'

import { isDeepSeekOfficialHost, withDeepSeek1mSuffix } from '../utils'

describe('isDeepSeekOfficialHost', () => {
  it('matches the canonical DeepSeek Anthropic endpoint', () => {
    expect(isDeepSeekOfficialHost('https://api.deepseek.com/anthropic')).toBe(true)
    expect(isDeepSeekOfficialHost('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekOfficialHost('  https://api.deepseek.com/anthropic  ')).toBe(true)
  })

  it('matches future deepseek subdomains via hostname suffix', () => {
    expect(isDeepSeekOfficialHost('https://api-1m.api.deepseek.com/anthropic')).toBe(true)
  })

  it('rejects third-party hosts that route to deepseek models', () => {
    expect(isDeepSeekOfficialHost('https://openrouter.ai/api/v1')).toBe(false)
    expect(isDeepSeekOfficialHost('https://api.fireworks.ai/inference')).toBe(false)
    expect(isDeepSeekOfficialHost('https://deepseek.alayanew.com')).toBe(false)
  })

  it('handles missing or malformed hosts gracefully', () => {
    expect(isDeepSeekOfficialHost(undefined)).toBe(false)
    expect(isDeepSeekOfficialHost('')).toBe(false)
    expect(isDeepSeekOfficialHost('   ')).toBe(false)
    expect(isDeepSeekOfficialHost('not a url')).toBe(false)
  })
})

describe('withDeepSeek1mSuffix', () => {
  const officialHost = 'https://api.deepseek.com/anthropic'
  const thirdPartyHost = 'https://openrouter.ai/api/v1'

  it('appends [1m] to V4+ pro models on the official host', () => {
    expect(withDeepSeek1mSuffix('deepseek-v4-pro', officialHost)).toBe('deepseek-v4-pro[1m]')
    expect(withDeepSeek1mSuffix('deepseek-v4', officialHost)).toBe('deepseek-v4[1m]')
    expect(withDeepSeek1mSuffix('deepseek-v5-pro', officialHost)).toBe('deepseek-v5-pro[1m]')
  })

  it('leaves the id alone when an existing [1m] suffix is present', () => {
    expect(withDeepSeek1mSuffix('deepseek-v4-pro[1m]', officialHost)).toBe('deepseek-v4-pro[1m]')
    expect(withDeepSeek1mSuffix('deepseek-v4-pro[1M]', officialHost)).toBe('deepseek-v4-pro[1M]')
  })

  it('does not append [1m] for flash variants (64K context, not 1M)', () => {
    expect(withDeepSeek1mSuffix('deepseek-v4-flash', officialHost)).toBe('deepseek-v4-flash')
    expect(withDeepSeek1mSuffix('deepseek-v5-flash', officialHost)).toBe('deepseek-v5-flash')
  })

  it('does not append [1m] when host is not DeepSeek-official', () => {
    expect(withDeepSeek1mSuffix('deepseek-v4-pro', thirdPartyHost)).toBe('deepseek-v4-pro')
    expect(withDeepSeek1mSuffix('deepseek-v4-pro', undefined)).toBe('deepseek-v4-pro')
  })

  it('leaves non-DeepSeek-V4+ models untouched', () => {
    expect(withDeepSeek1mSuffix('deepseek-v3.2', officialHost)).toBe('deepseek-v3.2')
    expect(withDeepSeek1mSuffix('deepseek-chat', officialHost)).toBe('deepseek-chat')
    expect(withDeepSeek1mSuffix('claude-opus-4-7', officialHost)).toBe('claude-opus-4-7')
    expect(withDeepSeek1mSuffix('gpt-4', officialHost)).toBe('gpt-4')
  })

  it('returns empty string when modelId is missing', () => {
    expect(withDeepSeek1mSuffix(undefined, officialHost)).toBe('')
    expect(withDeepSeek1mSuffix('', officialHost)).toBe('')
  })
})
