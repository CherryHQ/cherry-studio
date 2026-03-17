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
  usingBrowser: z.boolean(),
  defaultApiHost: z.string()
})

type WebSearchProviderPresetDefinition = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  usingBrowser: boolean
  defaultApiHost: string
}

export const WebSearchProviderOverrideSchema = z.object({
  apiKey: z.string().optional(),
  apiHost: z.string().optional(),
  engines: z.array(z.string()).optional(),
  basicAuthUsername: z.string().optional(),
  basicAuthPassword: z.string().optional()
})

export const PRESETS_WEB_SEARCH_PROVIDERS = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
  },
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.tavily.com'
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: ''
  },
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.exa.ai'
  },
  {
    id: 'exa-mcp',
    name: 'ExaMCP',
    type: 'mcp',
    usingBrowser: false,
    defaultApiHost: 'https://mcp.exa.ai/mcp'
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    usingBrowser: false,
    defaultApiHost: 'https://api.bochaai.com'
  },
  {
    id: 'local-google',
    name: 'Google',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'local-bing',
    name: 'Bing',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
  },
  {
    id: 'local-baidu',
    name: 'Baidu',
    type: 'local',
    usingBrowser: true,
    defaultApiHost: 'https://www.baidu.com/s?wd=%s'
  }
] as const satisfies readonly WebSearchProviderPresetDefinition[]

export const WebSearchProviderOverridesSchema = z.partialRecord(
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema
)

export interface WebSearchProviderPreset extends WebSearchProviderPresetDefinition {
  id: WebSearchProviderId
}
