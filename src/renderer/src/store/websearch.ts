import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { WebSearchProvider } from '@renderer/types'
export interface WebSearchState {
  defaultProvider: string
  providers: WebSearchProvider[]
  searchWithTime: boolean
  maxResults: number
  excludeDomains: string[]
}

const initialState: WebSearchState = {
  defaultProvider: 'tavily',
  providers: [
    {
      id: 'tavily',
      name: 'Tavily',
      apiKey: ''
    }
  ],
  searchWithTime: true,
  maxResults: 5,
  excludeDomains: []
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
    }
  }
})

export const {
  setWebSearchProviders,
  updateWebSearchProvider,
  setDefaultProvider,
  setSearchWithTime,
  setExcludeDomains,
  setMaxResult
} = websearchSlice.actions

export default websearchSlice.reducer
