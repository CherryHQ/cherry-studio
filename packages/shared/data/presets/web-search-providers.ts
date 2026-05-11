import * as z from 'zod'

import {
  WEB_SEARCH_CAPABILITIES,
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDER_TYPES,
  type WebSearchCapability,
  type WebSearchProviderCapabilityOverride,
  type WebSearchProviderCapabilityOverrides,
  type WebSearchProviderId,
  type WebSearchProviderOverride,
  type WebSearchProviderOverrides,
  type WebSearchProviderType
} from '../preference/preferenceTypes'

export const WebSearchProviderTypeSchema = z.enum(WEB_SEARCH_PROVIDER_TYPES)

export const WebSearchProviderIdSchema = z.enum(WEB_SEARCH_PROVIDER_IDS)

export const WebSearchCapabilitySchema = z.enum(WEB_SEARCH_CAPABILITIES)

export const WebSearchSearchKeywordsCapabilitySchema = z
  .object({
    feature: z.literal('searchKeywords'),
    apiHost: z.string().optional()
  })
  .strict()

export const WebSearchFetchUrlsCapabilitySchema = z
  .object({
    feature: z.literal('fetchUrls'),
    apiHost: z.string().optional()
  })
  .strict()

export const WebSearchProviderFeatureCapabilitySchema = z.discriminatedUnion('feature', [
  WebSearchSearchKeywordsCapabilitySchema,
  WebSearchFetchUrlsCapabilitySchema
])

export type WebSearchProviderFeatureCapability = z.infer<typeof WebSearchProviderFeatureCapabilitySchema>

export const WebSearchProviderPresetDefinitionSchema = z.object({
  id: WebSearchProviderIdSchema,
  name: z.string(),
  type: WebSearchProviderTypeSchema,
  capabilities: z.array(WebSearchProviderFeatureCapabilitySchema).min(1)
})

type WebSearchProviderPresetConfig = {
  name: string
  type: WebSearchProviderType
  capabilities: readonly WebSearchProviderFeatureCapability[]
}

export const WebSearchProviderOverrideSchema = z.object({
  apiKeys: z.array(z.string()).optional(),
  capabilities: z
    .object({
      searchKeywords: z
        .object({
          apiHost: z.string().optional()
        })
        .strict()
        .optional(),
      fetchUrls: z
        .object({
          apiHost: z.string().optional()
        })
        .strict()
        .optional()
    })
    .strict()
    .optional(),
  engines: z.array(z.string()).optional(),
  basicAuthUsername: z.string().optional(),
  basicAuthPassword: z.string().optional()
}) satisfies z.ZodType<WebSearchProviderOverride>

export const WebSearchProviderOverridesSchema = z.partialRecord(
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema
) satisfies z.ZodType<WebSearchProviderOverrides>

export const WebSearchProviderCapabilityOverrideSchema: z.ZodType<WebSearchProviderCapabilityOverride> = z
  .object({
    apiHost: z.string().optional()
  })
  .strict()

export const WebSearchProviderCapabilityOverridesSchema: z.ZodType<WebSearchProviderCapabilityOverrides> = z
  .object({
    searchKeywords: WebSearchProviderCapabilityOverrideSchema.optional(),
    fetchUrls: WebSearchProviderCapabilityOverrideSchema.optional()
  })
  .strict()

export interface WebSearchProviderPreset extends WebSearchProviderPresetConfig {
  id: WebSearchProviderId
}

export const WEB_SEARCH_PROVIDER_PRESET_MAP = {
  zhipu: {
    name: 'Zhipu',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search' }]
  },
  tavily: {
    name: 'Tavily',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }]
  },
  searxng: {
    name: 'Searxng',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: '' }]
  },
  exa: {
    name: 'Exa',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.exa.ai' }]
  },
  'exa-mcp': {
    name: 'ExaMCP',
    type: 'mcp',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://mcp.exa.ai/mcp' }]
  },
  bocha: {
    name: 'Bocha',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.bochaai.com' }]
  },
  querit: {
    name: 'Querit',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.querit.ai' }]
  },
  fetch: {
    name: 'fetch',
    type: 'api',
    capabilities: [{ feature: 'fetchUrls' }]
  },
  jina: {
    name: 'Jina',
    type: 'api',
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ]
  }
} as const satisfies Record<WebSearchProviderId, WebSearchProviderPresetConfig>

export const PRESETS_WEB_SEARCH_PROVIDERS: readonly WebSearchProviderPreset[] = WEB_SEARCH_PROVIDER_IDS.map((id) => ({
  id,
  ...WEB_SEARCH_PROVIDER_PRESET_MAP[id]
}))

export function findWebSearchCapability(
  provider: { capabilities: readonly WebSearchProviderFeatureCapability[] },
  capability: WebSearchCapability
): WebSearchProviderFeatureCapability | undefined {
  return provider.capabilities.find((item) => item.feature === capability)
}
