import * as z from 'zod'

export const WebSearchProviderTypeSchema = z.enum(['api', 'local', 'mcp'])

export type WebSearchProviderType = z.infer<typeof WebSearchProviderTypeSchema>

export const WebSearchProviderPresetDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: WebSearchProviderTypeSchema,
  usingBrowser: z.boolean(),
  defaultApiHost: z.string()
})

type WebSearchProviderPresetDefinition = z.infer<typeof WebSearchProviderPresetDefinitionSchema>

export const WebSearchProviderOverrideSchema = z.object({
  apiKey: z.string().optional(),
  apiHost: z.string().optional(),
  engines: z.array(z.string()).optional(),
  basicAuthUsername: z.string().optional(),
  basicAuthPassword: z.string().optional()
})

export type WebSearchProviderOverride = z.infer<typeof WebSearchProviderOverrideSchema>

const WebSearchProviderPresetListSchema = z.array(WebSearchProviderPresetDefinitionSchema)

const validateWebSearchProviderPresets = <const T extends readonly WebSearchProviderPresetDefinition[]>(
  presets: T
): T => {
  return WebSearchProviderPresetListSchema.parse(presets) as unknown as T
}

export const PRESETS_WEB_SEARCH_PROVIDERS = validateWebSearchProviderPresets([
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
])

export type WebSearchProviderId = (typeof PRESETS_WEB_SEARCH_PROVIDERS)[number]['id']

const webSearchProviderIds = PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => preset.id) as [
  WebSearchProviderId,
  ...WebSearchProviderId[]
]

export const WebSearchProviderIdSchema = z.enum(webSearchProviderIds)

export const WebSearchProviderOverridesSchema = z.partialRecord(
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema
)

export type WebSearchProviderOverrides = z.infer<typeof WebSearchProviderOverridesSchema>

export interface WebSearchProviderPreset extends WebSearchProviderPresetDefinition {
  id: WebSearchProviderId
}
