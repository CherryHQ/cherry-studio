import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { WebSearchProvider } from '@renderer/types'
export interface WebSearchState {
  defaultProvider: string
  providers: WebSearchProvider[]
  searchWithTime: boolean
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
  searchWithTime: true
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
    }
  }
})

export const { setWebSearchProviders, updateWebSearchProvider, setDefaultProvider, setSearchWithTime } =
  websearchSlice.actions

export default websearchSlice.reducer
