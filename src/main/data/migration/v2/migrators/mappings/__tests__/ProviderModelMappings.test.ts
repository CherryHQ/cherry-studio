import { ENDPOINT_TYPE, type ProviderConfig } from '@cherrystudio/provider-registry'
import type { Provider as LegacyProvider } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { transformProvider } from '../ProviderModelMappings'

function makeLegacy(overrides: Partial<LegacyProvider>): LegacyProvider {
  return {
    id: overrides.id ?? 'silicon',
    name: overrides.name ?? 'Silicon',
    type: overrides.type ?? 'openai',
    apiKey: overrides.apiKey ?? 'sk-xxx',
    apiHost: overrides.apiHost ?? 'https://api.siliconflow.cn/v1',
    enabled: overrides.enabled ?? true,
    models: overrides.models ?? [],
    ...overrides
  } as LegacyProvider
}

function makeCatalog(adapterFamilies: Partial<Record<string, string>>): ProviderConfig {
  const endpointConfigs: Record<string, { adapterFamily: string }> = {}
  for (const [ep, family] of Object.entries(adapterFamilies)) {
    if (family) endpointConfigs[ep] = { adapterFamily: family }
  }
  return {
    id: 'catalog-id',
    name: 'Catalog',
    defaultChatEndpoint: null,
    metadata: { website: {} },
    endpointConfigs
  } as unknown as ProviderConfig
}

describe('transformProvider', () => {
  describe('adapterFamily backfill', () => {
    it('writes adapterFamily for every endpoint present in legacy data', () => {
      const legacy = makeLegacy({
        id: 'silicon',
        type: 'openai',
        apiHost: 'https://api.siliconflow.cn/v1',
        anthropicApiHost: 'https://api.siliconflow.cn'
      })
      const catalog = makeCatalog({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai-compatible',
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic'
      })

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]).toMatchObject({
        baseUrl: 'https://api.siliconflow.cn/v1',
        adapterFamily: 'openai-compatible'
      })
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toMatchObject({
        baseUrl: 'https://api.siliconflow.cn',
        adapterFamily: 'anthropic'
      })
    })

    it('only writes adapterFamily for endpoints that legacy actually configured', () => {
      // Legacy only has apiHost (openai endpoint); catalog also defines an
      // anthropic-messages endpoint with adapterFamily. The migration must
      // NOT seed the anthropic endpoint from catalog alone — that would
      // synthesize a config the user never authored.
      const legacy = makeLegacy({ id: 'silicon', type: 'openai', apiHost: 'https://api.siliconflow.cn/v1' })
      const catalog = makeCatalog({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai-compatible',
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic'
      })

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('openai-compatible')
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).toBeUndefined()
    })

    it('falls back to type-inferred family when catalog is unavailable', () => {
      // Truly custom (non-catalog) provider — type-based inference still
      // gives the resolver an actionable adapterFamily.
      const legacy = makeLegacy({ id: 'my-custom', type: 'openai', apiHost: 'https://example.com/v1' })

      const result = transformProvider(legacy, {}, 0, null)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('openai-compatible')
    })

    it('falls back to type-inferred family when catalog has the endpoint but no family declared', () => {
      const legacy = makeLegacy({ id: 'silicon', type: 'openai' })
      const catalog = makeCatalog({})

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('openai-compatible')
    })

    it('always sets anthropic adapterFamily for ANTHROPIC_MESSAGES endpoints, even without catalog', () => {
      // Custom relay with anthropicApiHost — `legacy.id` not in catalog, but
      // the anthropic protocol always needs the anthropic adapter regardless.
      const legacy = makeLegacy({
        id: 'my-anthropic-relay',
        type: 'openai',
        apiHost: 'https://relay.example/v1',
        anthropicApiHost: 'https://relay.example/anthropic'
      })

      const result = transformProvider(legacy, {}, 0, null)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('openai-compatible')
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.adapterFamily).toBe('anthropic')
    })

    it('catalog wins over type-inferred family when both apply', () => {
      // legacy.type='openai' would map to 'openai-compatible', but catalog
      // says 'openai-chat-completions' uses 'cherryin' adapter family.
      const legacy = makeLegacy({ id: 'cherryin', type: 'openai', apiHost: 'https://open.cherryin.net' })
      const catalog = makeCatalog({ [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'cherryin' })

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('cherryin')
    })

    it('catalog wins over ANTHROPIC default when both apply', () => {
      // aihubmix's anthropic-messages endpoint uses adapterFamily='aihubmix'
      // (catalog encodes the multi-provider relay routing). The ANTHROPIC
      // default must not override this.
      const legacy = makeLegacy({
        id: 'aihubmix',
        type: 'openai',
        anthropicApiHost: 'https://aihubmix.com'
      })
      const catalog = makeCatalog({ [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'aihubmix' })

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.adapterFamily).toBe('aihubmix')
    })

    it('writes adapterFamily for grok using catalog values (replaces hardcoded xai-responses)', () => {
      // grok's catalog entry maps openai-chat-completions → 'xai' and
      // openai-responses → 'xai-responses'. The legacy chain returned
      // xai-responses unconditionally; the catalog encodes the per-endpoint
      // distinction.
      const legacy = makeLegacy({ id: 'grok', type: 'openai', apiHost: 'https://api.x.ai/v1' })
      const catalog = makeCatalog({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'xai',
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'xai-responses'
      })

      const result = transformProvider(legacy, {}, 0, catalog)

      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.adapterFamily).toBe('xai')
      // openai-responses endpoint wasn't in legacy → not seeded
      expect(result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_RESPONSES]).toBeUndefined()
    })

    it('preserves existing endpoint fields (baseUrl, reasoningFormatType) when adding adapterFamily', () => {
      const legacy = makeLegacy({ id: 'openai', type: 'openai', apiHost: 'https://api.openai.com/v1' })
      const catalog = makeCatalog({ [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai' })

      const result = transformProvider(legacy, {}, 0, catalog)

      const cfg = result.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      expect(cfg).toMatchObject({
        baseUrl: 'https://api.openai.com/v1',
        reasoningFormatType: 'openai-chat',
        adapterFamily: 'openai'
      })
    })
  })
})
