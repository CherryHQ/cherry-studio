import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import {
  resolveAiSdkProviderId,
  resolveEffectiveEndpoint,
  resolveProviderOptionsKey,
  resolveProviderVariant,
  resolveWireModelId
} from '../endpoint'

const ENDPOINT_TYPES_USED = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
] as const

describe('resolveWireModelId', () => {
  // `@ai-sdk/google` matches its feature allowlists (googleSearch, urlContext, …)
  // against the exact id, so a `models/`-prefixed id — how Gemini's /models listing
  // names them, still present on rows synced before ingestion stripped it — silently
  // drops every provider-native tool from the request.
  it('strips the Gemini listing prefix on the google endpoint', () => {
    const model = makeModel({
      id: 'gemini::models/gemini-flash-latest',
      providerId: 'gemini',
      apiModelId: 'models/gemini-flash-latest'
    })
    expect(resolveWireModelId(model, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe('gemini-flash-latest')
  })

  it('leaves other endpoints and unprefixed ids untouched', () => {
    const prefixed = makeModel({
      id: 'custom::models/foo',
      providerId: 'custom',
      apiModelId: 'models/foo'
    })
    expect(resolveWireModelId(prefixed, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toBe('models/foo')

    const plain = makeModel({ id: 'gemini::gemini-3-pro', providerId: 'gemini', apiModelId: 'gemini-3-pro' })
    expect(resolveWireModelId(plain, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe('gemini-3-pro')
  })

  it('falls back to the unique-id suffix when apiModelId is absent', () => {
    const model = makeModel({ id: 'gemini::gemini-flash-latest', providerId: 'gemini' })
    expect(resolveWireModelId(model, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe('gemini-flash-latest')
  })
})

describe('resolveProviderOptionsKey', () => {
  it.each(['google-vertex', 'google-vertex-anthropic', 'google-vertex-maas'])(
    'maps the %s runtime adapter to the Vertex provider-options namespace',
    (providerId) => {
      expect(resolveProviderOptionsKey(providerId)).toBe('vertex')
    }
  )

  it('preserves provider ids whose runtime namespace matches their registration', () => {
    expect(resolveProviderOptionsKey('openai')).toBe('openai')
  })

  it('uses the resolved gateway route instead of re-detecting the model in the encoder', () => {
    expect(
      resolveProviderOptionsKey('aihubmix', {
        actualProviderId: 'aihubmix',
        endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        gatewayProviderOptionsKey: 'google'
      })
    ).toBe('google')
  })

  it('uses the concrete provider namespace for openai-compatible adapters', () => {
    expect(
      resolveProviderOptionsKey('openai-compatible', {
        actualProviderId: 'custom-relay',
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
    ).toBe('custom-relay')
  })
})

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
  it('ignores a provider default that the model does not support', () => {
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

  it('prefers a supported provider default over registry endpoint order', () => {
    const provider = makeProvider({
      id: 'deepseek',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.deepseek.com/responses' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com/chat' }
      }
    })
    const model = {
      id: 'deepseek-v4-flash',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    } as never

    expect(resolveEffectiveEndpoint(provider, model)).toMatchObject({
      endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      baseUrl: 'https://api.deepseek.com/chat'
    })
  })

  it('does not apply the chat default to a non-chat operation model', () => {
    const provider = makeProvider({
      id: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' },
        [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://relay.example/embeddings' }
      }
    })
    const model = makeModel({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    })

    expect(resolveEffectiveEndpoint(provider, model)).toMatchObject({
      endpointType: ENDPOINT_TYPE.OPENAI_EMBEDDINGS,
      baseUrl: 'https://relay.example/embeddings'
    })
  })

  it.each([MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK])(
    'does not assign the chat default to a capability-only %s model without endpointTypes',
    (capability) => {
      const provider = makeProvider({
        id: 'new-api',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' }
        }
      })
      const capabilityOnly = makeModel({ capabilities: [capability], endpointTypes: undefined })

      expect(resolveEffectiveEndpoint(provider, capabilityOnly)).toMatchObject({
        endpointType: undefined,
        baseUrl: ''
      })
    }
  )

  it('skips a supported chat default whose endpoint configuration is missing', () => {
    const provider = makeProvider({
      id: 'relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://relay.example/anthropic',
          adapterFamily: 'anthropic'
        }
      }
    })
    const model = makeModel({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })

    const resolved = resolveEffectiveEndpoint(provider, model)
    expect(resolved).toMatchObject({
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      baseUrl: 'https://relay.example/anthropic'
    })
    expect(resolveAiSdkProviderId(provider, resolved.endpointType)).toBe('anthropic')
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

  describe('preferredEndpointType', () => {
    // DeepSeek V4 Flash: `openai-responses` leads because it routes in-app chat, but the model also
    // serves Anthropic Messages — which is the only dialect the Claude Agent SDK can speak.
    const deepseek = makeProvider({
      id: 'deepseek',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://api.deepseek.com' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.deepseek.com/anthropic' }
      }
    })
    const flash = {
      id: 'deepseek-v4-flash',
      endpointTypes: [
        ENDPOINT_TYPE.OPENAI_RESPONSES,
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ]
    } as never

    it('wins over model.endpointTypes[0] when the model declares it', () => {
      expect(resolveEffectiveEndpoint(deepseek, flash, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toMatchObject({
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        baseUrl: 'https://api.deepseek.com/anthropic'
      })
      expect(resolveEffectiveEndpoint(deepseek, flash).endpointType).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    })

    it('is declined when the model does not declare it', () => {
      const chatOnly = { id: 'deepseek-chat', endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] } as never
      expect(resolveEffectiveEndpoint(deepseek, chatOnly, ENDPOINT_TYPE.ANTHROPIC_MESSAGES).endpointType).toBe(
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      )
    })

    it('is declined when the provider configures no base URL for it', () => {
      // `getBaseUrl` cascades, so honouring the preference here would hand back the OpenAI host.
      const relay = makeProvider({
        id: 'relay',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example.com' } }
      })
      const model = {
        id: 'm',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      } as never
      expect(resolveEffectiveEndpoint(relay, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toMatchObject({
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        baseUrl: 'https://relay.example.com'
      })
    })

    it('leaves the gateway route untouched for models that declare no endpoints', () => {
      const model = { id: 'm' } as never
      expect(resolveEffectiveEndpoint(deepseek, model, ENDPOINT_TYPE.ANTHROPIC_MESSAGES).endpointType).toBe(
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      )
    })
  })

  describe('multi-backend gateway per-model routing (AiHubMix)', () => {
    // AiHubMix models carry no `endpointTypes` (its /models list has no `supported_endpoint_types`),
    // so the endpoint must be resolved from the model id — otherwise every route collapses onto the
    // default openai-chat endpoint and the reasoning namespace/dialect is wrong for claude/gemini/gpt.
    const aihubmix = makeProvider({
      id: 'aihubmix',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://aihubmix.com/v1', adapterFamily: 'aihubmix' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.com', adapterFamily: 'aihubmix' },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://aihubmix.com/v1', adapterFamily: 'aihubmix' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://aihubmix.com/gemini/v1beta',
          adapterFamily: 'aihubmix'
        }
      }
    })

    it.each([
      ['claude-opus-4-6', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
      ['gemini-2.5-pro', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google'],
      ['gpt-4o', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai'],
      ['glm-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'aihubmix']
    ] as const)('resolves %s → %s / %s from the model id', (id, endpointType, providerOptionsKey) => {
      expect(resolveEffectiveEndpoint(aihubmix, { id } as never)).toMatchObject({
        endpointType,
        providerOptionsKey
      })
    })

    it('routes by apiModelId when present (renamed/user-added ids)', () => {
      const model = { id: 'my-alias', apiModelId: 'claude-sonnet-4-5' } as never
      expect(resolveEffectiveEndpoint(aihubmix, model).endpointType).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    })

    it('lets an explicit model.endpointTypes hint win over the gateway route', () => {
      const model = { id: 'claude-opus-4-6', endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] } as never
      expect(resolveEffectiveEndpoint(aihubmix, model)).toMatchObject({
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerOptionsKey: undefined
      })
    })

    it('does NOT route to an endpoint the provider row does not declare (stale insert-only seed)', () => {
      // A row seeded before google/responses were added to the catalog only has the original two
      // endpoints. Routing gemini/gpt to the undeclared endpoint would drop aiSdkProviderId off the
      // `aihubmix` family and hand the model to the generic openai-compatible client. Fall through to
      // the default instead — no regression until the row is reconciled.
      const staleAihubmix = makeProvider({
        id: 'aihubmix',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://aihubmix.com/v1', adapterFamily: 'aihubmix' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.com', adapterFamily: 'aihubmix' }
        }
      })
      // gemini/gpt endpoints are undeclared → fall back to the default; claude is declared → still routes.
      expect(resolveEffectiveEndpoint(staleAihubmix, { id: 'gemini-2.5-pro' } as never).endpointType).toBe(
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      )
      expect(
        resolveEffectiveEndpoint(staleAihubmix, { id: 'gemini-2.5-pro' } as never).providerOptionsKey
      ).toBeUndefined()
      expect(resolveEffectiveEndpoint(staleAihubmix, { id: 'gpt-4o' } as never).endpointType).toBe(
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      )
      expect(resolveEffectiveEndpoint(staleAihubmix, { id: 'claude-opus-4-6' } as never).endpointType).toBe(
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      )
    })
  })

  describe('multi-backend gateway per-model routing (DMXAPI)', () => {
    const dmxapi = makeProvider({
      id: 'dmxapi',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://www.dmxapi.cn',
          adapterFamily: 'dmxapi'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://www.dmxapi.cn',
          adapterFamily: 'dmxapi'
        },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://www.dmxapi.cn/v1beta/',
          adapterFamily: 'dmxapi'
        }
      }
    })

    it.each([
      ['claude-opus-4-6', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
      ['gemini-2.5-pro', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google'],
      ['gpt-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai'],
      ['qwen3.5-plus', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'dmxapi']
    ] as const)('resolves %s → %s / %s from the model id', (id, endpointType, providerOptionsKey) => {
      expect(resolveEffectiveEndpoint(dmxapi, { id } as never)).toMatchObject({
        endpointType,
        providerOptionsKey
      })
    })

    it('keeps a stale row without the Google endpoint on its existing chat route', () => {
      const staleDmxapi = makeProvider({
        id: 'dmxapi',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://www.dmxapi.cn',
            adapterFamily: 'openai-compatible'
          },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://www.dmxapi.cn',
            adapterFamily: 'anthropic'
          }
        }
      })

      expect(resolveEffectiveEndpoint(staleDmxapi, { id: 'gemini-2.5-pro' } as never).endpointType).toBe(
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      )
      expect(resolveEffectiveEndpoint(staleDmxapi, { id: 'claude-opus-4-6' } as never).endpointType).toBe(
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      )
    })
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
