import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint, resolveProviderVariant } from '../endpoint'

const ENDPOINT_TYPES_USED = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
] as const

describe('resolveAiSdkProviderId', () => {
  describe('Catalog adapterFamily (highest priority)', () => {
    it('uses adapterFamily on the selected endpoint, overriding provider.id heuristics', () => {
      const provider = makeProvider({
        id: 'silicon',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.siliconflow.cn/v1',
            adapterFamily: 'openai-compatible'
          },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://api.siliconflow.cn',
            adapterFamily: 'anthropic'
          }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('openai-compatible')
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('anthropic')
    })

    it('applies variant suffix on top of a base adapterFamily', () => {
      // Catalog stores `openai` for openai-responses endpoint; variant
      // resolution should still upgrade it to `openai-responses`.
      const provider = makeProvider({
        id: 'openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
            baseUrl: 'https://api.openai.com/v1',
            adapterFamily: 'openai'
          }
        }
      })
      // Note: appProviderIds maps `openai-responses` to `openai` (aliased)
      // — verify the value either way is in the openai family.
      const resolved = resolveAiSdkProviderId(provider, ENDPOINT_TYPE.OPENAI_RESPONSES)
      expect(['openai', 'openai-responses']).toContain(resolved)
    })

    it('passes already-variant adapterFamily through idempotently', () => {
      // Azure's openai-responses endpoint stores `azure-responses` directly.
      const provider = makeProvider({
        id: 'azure-openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
            baseUrl: 'https://x.openai.azure.com',
            adapterFamily: 'azure-responses'
          }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe('azure-responses')
    })

    it('ignores adapterFamily when endpointType is undefined', () => {
      // No endpoint selected → no per-endpoint config to read; falls through
      // to the unspecified-endpoint terminal branches (openai-compatible).
      const provider = makeProvider({
        id: 'anthropic',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
        }
      })
      expect(resolveAiSdkProviderId(provider, undefined)).toBe('openai-compatible')
    })

    it('returns openai-compatible when adapterFamily is unknown', () => {
      // Garbage adapterFamily that doesn't exist in appProviderIds. Resolver
      // makes no attempt to recover — UI/migrator owns adapterFamily quality.
      const provider = makeProvider({
        id: 'anthropic',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'totally-not-a-real-family' }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('openai-compatible')
    })

    it('returns openai-compatible when adapterFamily is missing entirely', () => {
      // Hand-rolled DataApi insert or test fixture without adapterFamily.
      // Resolver doesn't infer from provider.id or baseUrl — migration/seeder
      // is responsible for setting adapterFamily at write time.
      const provider = makeProvider({
        id: 'anthropic',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('openai-compatible')
    })
  })

  describe('Azure (catalog-driven)', () => {
    // azure-openai's catalog entry maps OPENAI_RESPONSES → 'azure-responses'
    // (already a variant id) and OPENAI_CHAT_COMPLETIONS → 'azure' (base id;
    // variant suffix is a no-op here since azure has no -chat variant).
    it('routes openai-responses endpoint to azure-responses via adapterFamily', () => {
      const provider = makeProvider({
        id: 'azure-openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'azure-responses' }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe('azure-responses')
    })

    it('routes openai-chat-completions endpoint to azure via adapterFamily', () => {
      const provider = makeProvider({
        id: 'azure-openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'azure' }
        }
      })
      expect(resolveAiSdkProviderId(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('azure')
    })
  })

  describe('Catalog-backed registered extensions', () => {
    // Post-backfill, every seeded/migrated catalog provider arrives with
    // `endpointConfigs[ep].adapterFamily` set. Fixtures mirror that shape.
    const catalogProvider = (id: string, endpointType: EndpointType, adapterFamily: string) =>
      makeProvider({ id, endpointConfigs: { [endpointType]: { adapterFamily } } })

    it('routes anthropic provider to anthropic adapter', () => {
      expect(
        resolveAiSdkProviderId(
          catalogProvider('anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'),
          ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        )
      ).toBe('anthropic')
    })

    it('routes openai provider + chat endpoint to openai-chat variant', () => {
      expect(
        resolveAiSdkProviderId(
          catalogProvider('openai', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai'),
          ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        )
      ).toBe('openai-chat')
    })

    it('routes openai provider + responses endpoint to base openai (alias-resolved)', () => {
      // ai-core registers `openai-response` as an ALIAS of `openai` (not a
      // separate variant). The resolver returns the base id, which ai-core
      // then maps internally. Feature gates whitelist both `openai` and
      // `openai-response` so either side of the alias matches.
      expect(
        resolveAiSdkProviderId(
          catalogProvider('openai', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai'),
          ENDPOINT_TYPE.OPENAI_RESPONSES
        )
      ).toBe('openai')
    })

    it('routes deepseek provider unchanged (no variants registered)', () => {
      expect(
        resolveAiSdkProviderId(
          catalogProvider('deepseek', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'deepseek'),
          ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        )
      ).toBe('deepseek')
    })

    it('routes openrouter to openrouter adapter regardless of endpoint', () => {
      expect(
        resolveAiSdkProviderId(
          catalogProvider('openrouter', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openrouter'),
          ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        )
      ).toBe('openrouter')
    })
  })

  describe('Relay-style multi-endpoint provider (post-migration shape)', () => {
    // MiniMax is a registered catalog provider, but the same shape applies to
    // any v1-migrated relay where the migrator writes adapterFamily per
    // endpoint (catalog hit OR type-inferred OR ANTHROPIC_MESSAGES default).
    function makeMiniMaxLike(): Provider {
      return makeProvider({
        id: 'minimax',
        presetProviderId: 'minimax',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.minimax.io/v1/',
            adapterFamily: 'openai-compatible'
          },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://api.minimax.io/anthropic',
            adapterFamily: 'anthropic'
          }
        }
      })
    }

    it('routes anthropic-messages endpoint to the anthropic adapter (REGRESSION)', () => {
      // Original bug: endpoint-blind resolver sent openai-format requests to
      // anthropic-protocol endpoints. Fix: every endpoint carries its own
      // adapterFamily, populated by seeder/migrator from catalog or inferred
      // from ANTHROPIC_MESSAGES → 'anthropic'.
      expect(resolveAiSdkProviderId(makeMiniMaxLike(), ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('anthropic')
    })

    it('routes openai-chat-completions endpoint to openai-compatible adapter (REGRESSION)', () => {
      expect(resolveAiSdkProviderId(makeMiniMaxLike(), ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('openai-compatible')
    })

    it('falls through to openai-compatible when endpointType is undefined', () => {
      const provider = makeProvider({ id: 'someUnknownProvider' })
      expect(resolveAiSdkProviderId(provider, undefined)).toBe('openai-compatible')
    })
  })
})

describe('resolveProviderVariant', () => {
  it('appends -chat for openai-chat-completions on bases with a chat variant', () => {
    expect(resolveProviderVariant('openai' as never, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('openai-chat')
  })

  it('returns the base id for openai-responses on bases without a -responses variant', () => {
    // Azure has a real `responses` variant (suffix-based, key `azure-responses`).
    // OpenAI only has an `openai-response` ALIAS pointing back to `openai` —
    // no plural-suffix variant — so the resolver falls back to the base.
    expect(resolveProviderVariant('openai' as never, ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe('openai')
  })

  it('appends -responses for azure base (real variant)', () => {
    expect(resolveProviderVariant('azure' as never, ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe('azure-responses')
  })

  it('returns the base id unchanged when no variant is registered', () => {
    expect(resolveProviderVariant('deepseek' as never, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('deepseek')
  })

  it('returns the base id unchanged when endpointType is undefined', () => {
    expect(resolveProviderVariant('openai' as never, undefined)).toBe('openai')
  })
})

describe('resolveEffectiveEndpoint', () => {
  it('prefers model.endpointTypes[0] over provider.defaultChatEndpoint', () => {
    const provider = makeProvider({
      id: 'minimax',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.minimax.io/v1/' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.minimax.io/anthropic' }
      }
    })
    const model = { id: 'm', endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] } as never
    const { endpointType, baseUrl } = resolveEffectiveEndpoint(provider, model)
    expect(endpointType).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    expect(baseUrl).toBe('https://api.minimax.io/anthropic')
  })

  it('falls back to provider.defaultChatEndpoint when model has no endpointTypes hint', () => {
    const provider = makeProvider({
      id: 'minimax',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.minimax.io/v1/' }
      }
    })
    const model = { id: 'm' } as never
    const { endpointType } = resolveEffectiveEndpoint(provider, model)
    expect(endpointType).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('returns undefined endpointType when neither model nor provider declare one', () => {
    const provider = makeProvider({ id: 'minimax' })
    const model = { id: 'm' } as never
    const { endpointType, baseUrl } = resolveEffectiveEndpoint(provider, model)
    expect(endpointType).toBeUndefined()
    expect(baseUrl).toBe('')
  })
})

describe('invariant: resolveAiSdkProviderId is deterministic for the registered preset matrix', () => {
  // Cross-product of a handful of registered provider ids × supported
  // endpoints. The point of this test is that the resolver returns a
  // stable AppProviderId without throwing, for every (provider, endpoint)
  // combination — not that the value matches a hand-curated table.
  const registeredIds = ['openai', 'anthropic', 'google', 'openrouter', 'deepseek', 'groq'] as const

  for (const id of registeredIds) {
    for (const endpointType of ENDPOINT_TYPES_USED) {
      it(`${id} / ${endpointType}: produces a non-empty AppProviderId`, () => {
        const provider = makeProvider({ id })
        const result = resolveAiSdkProviderId(provider, endpointType as EndpointType)
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })
    }
  }
})
