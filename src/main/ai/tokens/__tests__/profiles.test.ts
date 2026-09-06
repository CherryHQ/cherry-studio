import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveEndpointTokenDialect, resolveModelTokenDialect } from '../dialect'
import { getTextTokenizer, imageTokensFor } from '../profiles'

describe('resolveEndpointTokenDialect', () => {
  it.each([
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google'],
    [ENDPOINT_TYPE.OLLAMA_CHAT, 'ollama'],
    [ENDPOINT_TYPE.OLLAMA_GENERATE, 'ollama'],
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai'],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai']
  ] as const)('maps endpointType %s → %s (protocol, not vendor family)', (endpointType, dialect) => {
    expect(resolveEndpointTokenDialect(endpointType)).toBe(dialect)
  })

  it('falls back to openai for undefined', () => {
    expect(resolveEndpointTokenDialect(undefined)).toBe('openai')
  })
})

describe('resolveModelTokenDialect', () => {
  it('keys on the endpoint protocol, not a relay vendor adapterFamily', () => {
    // AiHubMix-style relay: anthropic-messages endpoint carrying a vendor family.
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'aihubmix' } }
    })
    const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
    expect(resolveModelTokenDialect(provider, model)).toBe('anthropic')
  })
})

describe('profile accessors', () => {
  it('uses the real BPE tokenizer for openai (lazy-loaded) and tokenx elsewhere', async () => {
    expect((await getTextTokenizer('openai')).id).toBe('gpt-tokenizer/o200k')
    for (const dialect of ['anthropic', 'google', 'ollama'] as const) {
      expect((await getTextTokenizer(dialect)).id).toBe('tokenx')
    }
  })

  it('returns the documented per-dialect constant when dimensions are unknown', () => {
    expect(imageTokensFor('anthropic')).toBe(1590)
    expect(imageTokensFor('openai')).toBe(765)
    expect(imageTokensFor('google')).toBe(258)
    expect(imageTokensFor('ollama')).toBe(1000)
  })

  it('applies the pixel formula when dimensions are provided', () => {
    // Under the 1.15 MP budget → straight ceil(w·h/750); ollama ignores dims (flat constant).
    expect(imageTokensFor('anthropic', { width: 750, height: 750 })).toBe(Math.ceil((750 * 750) / 750))
    expect(imageTokensFor('ollama', { width: 4000, height: 4000 })).toBe(1000)
  })
})
