import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { WebSearchProvider } from '@renderer/types'

export interface WebSearchState {
  // 默认搜索提供商的ID
  defaultProvider: string
  // 所有可用的搜索提供商列表
  providers: WebSearchProvider[]
  // 是否在搜索查询中添加当前日期
  searchWithTime: boolean
  // 搜索结果的最大数量
  maxResults: number
  // 要排除的域名列表
  excludeDomains: string[]
  // 是否启用搜索增强模式
  enhanceMode: boolean
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
  enhanceMode: false
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
    setEnhanceMode: (state, action: PayloadAction<boolean>) => {
      state.enhanceMode = action.payload
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
  setEnhanceMode
} = websearchSlice.actions

export default websearchSlice.reducer
