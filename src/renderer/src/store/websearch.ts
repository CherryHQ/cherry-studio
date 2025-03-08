import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { WebSearchProvider } from '@renderer/types'
export interface SubscribeSource {
  key: number
  url: string
  name: string
  blacklist?: string[] // 存储从该订阅源获取的黑名单
}
export interface WebSearchState {
  defaultProvider: string
  providers: WebSearchProvider[]
  searchWithTime: boolean
  maxResults: number
  excludeDomains: string[]
  subscribeSources: SubscribeSource[]
}

const initialState: WebSearchState = {
  defaultProvider: '',
  providers: [
    {
      id: 'tavily',
      name: 'Tavily',
      apiKey: ''
    },
    {
      id: 'searxng',
      name: 'Searxng',
      apiHost: ''
    },
    {
      id: 'exa',
      name: 'Exa',
      apiKey: ''
    }
  ],
  searchWithTime: true,
  maxResults: 5,
  excludeDomains: [],
  subscribeSources: []
}

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
    updateWebSearchProvider: (state, action: PayloadAction<WebSearchProvider>) => {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        state.providers[index] = action.payload
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
  setSubscribeSources
} = websearchSlice.actions

export default websearchSlice.reducer
