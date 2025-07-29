import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Model, WebSearchProvider } from '@renderer/types'
export interface SubscribeSource {
  key: number
  url: string
  name: string
  blacklist?: string[] // 存储从该订阅源获取的黑名单
}

export interface CompressionConfig {
  method: 'none' | 'cutoff' | 'rag'
  cutoffLimit?: number
  cutoffUnit?: 'char' | 'token'
  embeddingModel?: Model
  embeddingDimensions?: number // undefined表示自动获取
  documentCount?: number // 每个搜索结果的文档数量（只是预期值）
  rerankModel?: Model
}

export interface WebSearchState {
  // 默认搜索提供商的ID
  /** @deprecated 支持在快捷菜单中自选搜索供应商，所以这个不再适用 */
  defaultProvider: string
  // 所有可用的搜索提供商列表
  providers: WebSearchProvider[]
  // 是否在搜索查询中添加当前日期
  searchWithTime: boolean
  // 搜索结果的最大数量
  maxResults: number
  // 要排除的域名列表
  excludeDomains: string[]
  // 订阅源列表
  subscribeSources: SubscribeSource[]
  // 是否覆盖服务商搜索
  /** @deprecated 支持在快捷菜单中自选搜索供应商，所以这个不再适用 */
  overwrite: boolean
  // 搜索结果压缩
  compressionConfig?: CompressionConfig
  // 具体供应商的配置
  providerConfig: Record<string, any>
}

export const initialState: WebSearchState = {
  defaultProvider: 'local-bing',
  providers: [
    {
      id: 'tavily',
      name: 'Tavily',
      apiHost: 'https://api.tavily.com',
      apiKey: ''
    },
    {
      id: 'searxng',
      name: 'Searxng',
      apiHost: '',
      basicAuthUsername: '',
      basicAuthPassword: ''
    },
    {
      id: 'exa',
      name: 'Exa',
      apiHost: 'https://api.exa.ai',
      apiKey: ''
    },
    {
      id: 'bocha',
      name: 'Bocha',
      apiHost: 'https://api.bochaai.com',
      apiKey: ''
    },
    {
      id: 'local-google',
      name: 'Google',
      url: 'https://www.google.com/search?q=%s'
    },
    {
      id: 'local-bing',
      name: 'Bing',
      url: 'https://cn.bing.com/search?q=%s&ensearch=1'
    },
    {
      id: 'local-baidu',
      name: 'Baidu',
      url: 'https://www.baidu.com/s?wd=%s'
    }
  ],
  searchWithTime: true,
  maxResults: 5,
  excludeDomains: [],
  subscribeSources: [],
  overwrite: false,
  compressionConfig: {
    method: 'none',
    cutoffUnit: 'char'
  },
  providerConfig: {}
}

export const defaultWebSearchProviders = initialState.providers

const websearchSlice = createSlice({
  name: 'websearch',
  initialState,
  reducers: {
    setDefaultProvider: (state, action: PayloadAction<string>) => {
      state.defaultProvider = action.payload
    },
    setWebSearchProviders: (state, action: PayloadAction<WebSearchProvider[]>) => {
      state.providers = action.payload
    },
    updateWebSearchProviders: (state, action: PayloadAction<WebSearchProvider[]>) => {
      state.providers = action.payload
    },
    updateWebSearchProvider: (state, action: PayloadAction<Partial<WebSearchProvider> & { id: string }>) => {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        Object.assign(state.providers[index], action.payload)
      }
    },
    setSearchWithTime: (state, action: PayloadAction<boolean>) => {
      state.searchWithTime = action.payload
    },
    setMaxResult: (state, action: PayloadAction<number>) => {
      state.maxResults = action.payload
    },
    setExcludeDomains: (state, action: PayloadAction<string[]>) => {
      state.excludeDomains = action.payload
    },
    // 添加订阅源
    addSubscribeSource: (state, action: PayloadAction<Omit<SubscribeSource, 'key'>>) => {
      state.subscribeSources = state.subscribeSources || []
      const newKey =
        state.subscribeSources.length > 0 ? Math.max(...state.subscribeSources.map((item) => item.key)) + 1 : 0
      state.subscribeSources.push({
        key: newKey,
        url: action.payload.url,
        name: action.payload.name,
        blacklist: action.payload.blacklist
      })
    },
    // 删除订阅源
    removeSubscribeSource: (state, action: PayloadAction<number>) => {
      state.subscribeSources = state.subscribeSources.filter((source) => source.key !== action.payload)
    },
    // 更新订阅源的黑名单
    updateSubscribeBlacklist: (state, action: PayloadAction<{ key: number; blacklist: string[] }>) => {
      const source = state.subscribeSources.find((s) => s.key === action.payload.key)
      if (source) {
        source.blacklist = action.payload.blacklist
      }
    },
    // 更新订阅源列表
    setSubscribeSources: (state, action: PayloadAction<SubscribeSource[]>) => {
      state.subscribeSources = action.payload
    },
    setOverwrite: (state, action: PayloadAction<boolean>) => {
      state.overwrite = action.payload
    },
    addWebSearchProvider: (state, action: PayloadAction<WebSearchProvider>) => {
      // Check if provider with same ID already exists
      const exists = state.providers.some((provider) => provider.id === action.payload.id)

      if (!exists) {
        // Add the new provider to the array
        state.providers.push(action.payload)
      }
    },
    setCompressionConfig: (state, action: PayloadAction<CompressionConfig>) => {
      state.compressionConfig = action.payload
    },
    updateCompressionConfig: (state, action: PayloadAction<Partial<CompressionConfig>>) => {
      state.compressionConfig = {
        ...state.compressionConfig,
        ...action.payload
      } as CompressionConfig
    },
    setProviderConfig: (state, action: PayloadAction<Record<string, any>>) => {
      state.providerConfig = action.payload
    },
    updateProviderConfig: (state, action: PayloadAction<Record<string, any>>) => {
      state.providerConfig = { ...state.providerConfig, ...action.payload }
    }
  }
})

export const {
  setWebSearchProviders,
  updateWebSearchProvider,
  updateWebSearchProviders,
  setDefaultProvider,
  setSearchWithTime,
  setExcludeDomains,
  setMaxResult,
  addSubscribeSource,
  removeSubscribeSource,
  updateSubscribeBlacklist,
  setSubscribeSources,
  setOverwrite,
  addWebSearchProvider,
  setCompressionConfig,
  updateCompressionConfig,
  setProviderConfig,
  updateProviderConfig
} = websearchSlice.actions

export default websearchSlice.reducer
