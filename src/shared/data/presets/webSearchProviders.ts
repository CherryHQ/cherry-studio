import * as z from 'zod'

import { REMOTE_PROVIDER_IDS, type RemoteProviderId } from '@cherrystudio/web-search'
import { WEB_SEARCH_PROVIDER_CATALOG } from '@cherrystudio/web-search/catalog'

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
    requiresApiHost: z.boolean(),
    requiresApiKey: z.boolean(),
    apiHost: z.string().optional()
  })
  .strict()

export const WebSearchFetchUrlsCapabilitySchema = z
  .object({
    feature: z.literal('fetchUrls'),
    requiresApiHost: z.boolean(),
    requiresApiKey: z.boolean(),
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

const DESKTOP_REMOTE_CAPABILITIES: Record<RemoteProviderId, readonly WebSearchCapability[]> = {
  zhipu: ['searchKeywords'],
  tavily: ['searchKeywords'],
  searxng: ['searchKeywords'],
  exa: ['searchKeywords'],
  'exa-mcp': ['searchKeywords'],
  bocha: ['searchKeywords'],
  querit: ['searchKeywords', 'fetchUrls'],
  jina: ['searchKeywords', 'fetchUrls'],
  firecrawl: ['searchKeywords', 'fetchUrls'],
  crawl4ai: ['fetchUrls'],
  parallel: ['searchKeywords'],
  serply: ['searchKeywords'],
  yuanbao: ['searchKeywords'],
  deepseek: ['searchKeywords', 'fetchUrls'],
  searchapi: ['searchKeywords']
}

const remotePresets = Object.fromEntries(
  REMOTE_PROVIDER_IDS.map((id): [RemoteProviderId, WebSearchProviderPresetConfig] => {
    const metadata = WEB_SEARCH_PROVIDER_CATALOG[id]
    return [
      id,
      {
        name: metadata.name,
        type: metadata.type,
        capabilities: metadata.capabilities
          .filter((item) => DESKTOP_REMOTE_CAPABILITIES[id].includes(item.capability))
          .map<WebSearchProviderFeatureCapability>((item) => ({
            feature: item.capability,
            requiresApiHost: item.requiresApiHost,
            requiresApiKey: item.apiKey === 'required',
            apiHost: id === 'searxng' ? 'http://localhost:8080' : (item.defaultApiHost ?? '')
          }))
      }
    ]
  })
) as Record<RemoteProviderId, WebSearchProviderPresetConfig>

export const WEB_SEARCH_PROVIDER_PRESET_MAP: Record<WebSearchProviderId, WebSearchProviderPresetConfig> = {
  ...remotePresets,
  fetch: {
    name: 'fetch',
    type: 'api',
    capabilities: [{ feature: 'fetchUrls', requiresApiHost: false, requiresApiKey: false }]
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', requiresApiHost: false, requiresApiKey: false }]
  }
}

export const PRESETS_WEB_SEARCH_PROVIDERS: readonly WebSearchProviderPreset[] = WEB_SEARCH_PROVIDER_IDS.map((id) => ({
  id,
  ...WEB_SEARCH_PROVIDER_PRESET_MAP[id]
}))

export const WEB_SEARCH_FALLBACK_PROVIDER_IDS_BY_CAPABILITY = {
  searchKeywords: ['exa-mcp'],
  fetchUrls: ['fetch', 'jina']
} as const satisfies Record<WebSearchCapability, readonly WebSearchProviderId[]>
