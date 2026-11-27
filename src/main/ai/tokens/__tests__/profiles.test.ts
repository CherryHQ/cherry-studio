import { describe, expect, it } from 'vitest'

import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { resolveEndpointTokenDialect, resolveModelTokenDialect } from '../dialect'
import { imageTokensFor } from '../profiles'

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
  it('applies the pixel formula when dimensions are provided', () => {
    // Under the 1.15 MP budget → straight ceil(w·h/750); ollama ignores dims (flat constant).
    expect(imageTokensFor('anthropic', { width: 750, height: 750 })).toBe(Math.ceil((750 * 750) / 750))
  })
})
