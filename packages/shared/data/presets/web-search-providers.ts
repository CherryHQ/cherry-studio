import * as z from 'zod'

import {
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDER_TYPES,
  type WebSearchProviderId,
  type WebSearchProviderType
} from '../preference/preferenceTypes'

export const WebSearchProviderTypeSchema = z.enum(WEB_SEARCH_PROVIDER_TYPES)

export const WebSearchProviderIdSchema = z.enum(WEB_SEARCH_PROVIDER_IDS)

export const WebSearchProviderPresetDefinitionSchema = z.object({
  id: WebSearchProviderIdSchema,
  name: z.string(),
  type: WebSearchProviderTypeSchema,
  defaultApiHost: z.string()
})

type WebSearchProviderPresetConfig = {
  name: string
  type: WebSearchProviderType
  defaultApiHost: string
}

export const WebSearchProviderOverrideSchema = z.object({
  apiKeys: z.array(z.string()).optional(),
  apiHost: z.string().optional(),
  engines: z.array(z.string()).optional(),
  basicAuthUsername: z.string().optional(),
  basicAuthPassword: z.string().optional()
})

export const WebSearchProviderOverridesSchema = z.partialRecord(
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema
)

export interface WebSearchProviderPreset extends WebSearchProviderPresetConfig {
  id: WebSearchProviderId
}

export const WEB_SEARCH_PROVIDER_PRESET_MAP = {
  zhipu: {
    name: 'Zhipu',
    type: 'api',
    defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
  },
  tavily: {
    name: 'Tavily',
    type: 'api',
    defaultApiHost: 'https://api.tavily.com'
  },
  searxng: {
    name: 'Searxng',
    type: 'api',
    defaultApiHost: ''
  },
  exa: {
    name: 'Exa',
    type: 'api',
    defaultApiHost: 'https://api.exa.ai'
  },
  'exa-mcp': {
    name: 'ExaMCP',
    type: 'mcp',
    defaultApiHost: 'https://mcp.exa.ai/mcp'
  },
  bocha: {
    name: 'Bocha',
    type: 'api',
    defaultApiHost: 'https://api.bochaai.com'
  },
  querit: {
    name: 'Querit',
    type: 'api',
    defaultApiHost: 'https://api.querit.ai'
  }
} as const satisfies Record<WebSearchProviderId, WebSearchProviderPresetConfig>

export const PRESETS_WEB_SEARCH_PROVIDERS: readonly WebSearchProviderPreset[] = WEB_SEARCH_PROVIDER_IDS.map((id) => ({
  id,
  ...WEB_SEARCH_PROVIDER_PRESET_MAP[id]
}))
