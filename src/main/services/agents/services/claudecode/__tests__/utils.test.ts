import { describe, expect, it } from 'vitest'

import { isCherryInOfficialHost, isDeepSeekOfficialHost, isMiMoOfficialHost, with1mContextSuffix } from '../utils'

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

describe('isMiMoOfficialHost', () => {
  it('matches the canonical MiMo Anthropic endpoint', () => {
    expect(isMiMoOfficialHost('https://api.xiaomimimo.com/anthropic')).toBe(true)
    expect(isMiMoOfficialHost('https://api.xiaomimimo.com')).toBe(true)
    expect(isMiMoOfficialHost('  https://api.xiaomimimo.com/anthropic  ')).toBe(true)
  })

  it('matches Token Plan regional endpoints', () => {
    expect(isMiMoOfficialHost('https://token-plan-cn.xiaomimimo.com/anthropic')).toBe(true)
    expect(isMiMoOfficialHost('https://token-plan-sg.xiaomimimo.com/anthropic')).toBe(true)
    expect(isMiMoOfficialHost('https://token-plan-eu.xiaomimimo.com/anthropic')).toBe(true)
  })

  it('rejects third-party and lookalike hosts', () => {
    expect(isMiMoOfficialHost('https://openrouter.ai/api/v1')).toBe(false)
    expect(isMiMoOfficialHost('https://token-plan-cn.xiaomimimo.com.evil.com')).toBe(false)
    expect(isMiMoOfficialHost('https://notxiaomimimo.com/anthropic')).toBe(false)
  })

  it('handles missing or malformed hosts gracefully', () => {
    expect(isMiMoOfficialHost(undefined)).toBe(false)
    expect(isMiMoOfficialHost('')).toBe(false)
    expect(isMiMoOfficialHost('not a url')).toBe(false)
  })
})

describe('isCherryInOfficialHost', () => {
  it('matches CherryIN official endpoints', () => {
    expect(isCherryInOfficialHost('https://open.cherryin.cc')).toBe(true)
    expect(isCherryInOfficialHost('https://open.cherryin.net/anthropic')).toBe(true)
    expect(isCherryInOfficialHost('  https://open.cherryin.ai/v1  ')).toBe(true)
    expect(isCherryInOfficialHost('https://open.cherryin.dev')).toBe(true)
  })

  it('rejects third-party and lookalike hosts', () => {
    expect(isCherryInOfficialHost('https://openrouter.ai/api/v1')).toBe(false)
    expect(isCherryInOfficialHost('https://open.cherryin.net.evil.com')).toBe(false)
    expect(isCherryInOfficialHost('https://notopen.cherryin.net')).toBe(false)
  })

  it('handles missing or malformed hosts gracefully', () => {
    expect(isCherryInOfficialHost(undefined)).toBe(false)
    expect(isCherryInOfficialHost('')).toBe(false)
    expect(isCherryInOfficialHost('not a url')).toBe(false)
  })
})

describe('with1mContextSuffix', () => {
  const deepSeekHost = 'https://api.deepseek.com/anthropic'
  const cherryInHost = 'https://open.cherryin.cc'
  const mimoHost = 'https://api.xiaomimimo.com/anthropic'
  const thirdPartyHost = 'https://openrouter.ai/api/v1'

  it('appends [1m] to DeepSeek V4+ Pro models on the official host', () => {
    expect(with1mContextSuffix('deepseek-v4-pro', deepSeekHost)).toBe('deepseek-v4-pro[1m]')
    expect(with1mContextSuffix('deepseek-v4', deepSeekHost)).toBe('deepseek-v4[1m]')
    expect(with1mContextSuffix('deepseek-v5-pro', deepSeekHost)).toBe('deepseek-v5-pro[1m]')
  })

  it('appends [1m] to DeepSeek V4+ Flash (also 1M context)', () => {
    expect(with1mContextSuffix('deepseek-v4-flash', deepSeekHost)).toBe('deepseek-v4-flash[1m]')
    expect(with1mContextSuffix('deepseek-v5-flash', deepSeekHost)).toBe('deepseek-v5-flash[1m]')
  })

  it('appends [1m] to CherryIN DeepSeek V4+ agent models', () => {
    expect(with1mContextSuffix('agent/deepseek-v4-flash', cherryInHost)).toBe('agent/deepseek-v4-flash[1m]')
    expect(with1mContextSuffix('deepseek/deepseek-v4-flash', cherryInHost)).toBe('deepseek/deepseek-v4-flash[1m]')
    expect(with1mContextSuffix('agent/deepseek-v4-pro', cherryInHost)).toBe('agent/deepseek-v4-pro[1m]')
    expect(with1mContextSuffix('deepseek/deepseek-v4-pro', cherryInHost)).toBe('deepseek/deepseek-v4-pro[1m]')
  })

  it('appends [1m] to MiMo V2.5+ Pro/base models on the official host', () => {
    expect(with1mContextSuffix('mimo-v2.5-pro', mimoHost)).toBe('mimo-v2.5-pro[1m]')
    expect(with1mContextSuffix('mimo-v2.5', mimoHost)).toBe('mimo-v2.5[1m]')
    expect(with1mContextSuffix('mimo-v2.6-pro', mimoHost)).toBe('mimo-v2.6-pro[1m]')
    expect(with1mContextSuffix('mimo-v3-pro', mimoHost)).toBe('mimo-v3-pro[1m]')
  })

  it('appends [1m] to MiMo models on Token Plan endpoints', () => {
    const tokenPlanHost = 'https://token-plan-cn.xiaomimimo.com/anthropic'
    expect(with1mContextSuffix('mimo-v2.5-pro', tokenPlanHost)).toBe('mimo-v2.5-pro[1m]')
  })

  it('does not append [1m] for MiMo flash variants (256K context, not 1M)', () => {
    expect(with1mContextSuffix('mimo-v2.5-flash', mimoHost)).toBe('mimo-v2.5-flash')
  })

  it('leaves pre-2.5 MiMo models untouched', () => {
    expect(with1mContextSuffix('mimo-v2-flash', mimoHost)).toBe('mimo-v2-flash')
    expect(with1mContextSuffix('mimo-v2-omni', mimoHost)).toBe('mimo-v2-omni')
    expect(with1mContextSuffix('mimo-v2.4-pro', mimoHost)).toBe('mimo-v2.4-pro')
  })

  it('leaves the id alone when an existing [1m] suffix is present', () => {
    expect(with1mContextSuffix('deepseek-v4-pro[1m]', deepSeekHost)).toBe('deepseek-v4-pro[1m]')
    expect(with1mContextSuffix('deepseek-v4-pro[1M]', deepSeekHost)).toBe('deepseek-v4-pro[1M]')
    expect(with1mContextSuffix('mimo-v2.5-pro[1m]', mimoHost)).toBe('mimo-v2.5-pro[1m]')
  })

  it('does not append [1m] when host is not an official 1M host', () => {
    expect(with1mContextSuffix('deepseek-v4-pro', thirdPartyHost)).toBe('deepseek-v4-pro')
    expect(with1mContextSuffix('deepseek-v4-pro', undefined)).toBe('deepseek-v4-pro')
    expect(with1mContextSuffix('agent/deepseek-v4-flash', thirdPartyHost)).toBe('agent/deepseek-v4-flash')
    expect(with1mContextSuffix('mimo-v2.5-pro', thirdPartyHost)).toBe('mimo-v2.5-pro')
  })

  it('does not cross-apply provider rules between official hosts', () => {
    // MiMo id on DeepSeek host: not a DeepSeek V4+ id, left untouched
    expect(with1mContextSuffix('mimo-v2.5-pro', deepSeekHost)).toBe('mimo-v2.5-pro')
    // DeepSeek id on MiMo host: not a MiMo id, left untouched
    expect(with1mContextSuffix('deepseek-v4-pro', mimoHost)).toBe('deepseek-v4-pro')
  })

  it('leaves non-1M models untouched on the DeepSeek host', () => {
    expect(with1mContextSuffix('deepseek-v3.2', deepSeekHost)).toBe('deepseek-v3.2')
    expect(with1mContextSuffix('deepseek-chat', deepSeekHost)).toBe('deepseek-chat')
    expect(with1mContextSuffix('claude-opus-4-7', deepSeekHost)).toBe('claude-opus-4-7')
    expect(with1mContextSuffix('gpt-4', deepSeekHost)).toBe('gpt-4')
  })

  it('returns empty string when modelId is missing', () => {
    expect(with1mContextSuffix(undefined, deepSeekHost)).toBe('')
    expect(with1mContextSuffix('', deepSeekHost)).toBe('')
  })
})
