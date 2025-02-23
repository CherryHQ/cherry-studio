import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { WebSearchProvider } from '@renderer/types'
export interface WebSearchState {
  defaultProvider: string
  providers: WebSearchProvider[]
}

const initialState: WebSearchState = {
  defaultProvider: 'tavily',
  providers: [
    {
      id: 'tavily',
      name: 'Tavily',
      apiKey: ''
    }
  ]
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
    }
  }
})

export const { setWebSearchProviders, updateWebSearchProvider, setDefaultProvider } = websearchSlice.actions

export default websearchSlice.reducer
