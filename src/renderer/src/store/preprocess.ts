import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { PreprocessProvider } from '@renderer/types'

export interface PreprocessState {
  providers: PreprocessProvider[]
  defaultProvider: string
}

const initialState: PreprocessState = {
  providers: [
    {
      id: 'mineru',
      name: 'MinerU',
      apiKey: '',
      apiHost: 'https://mineru.net'
    },
    {
      id: 'doc2x',
      name: 'Doc2x',
      apiKey: '',
      apiHost: 'https://v2.doc2x.noedgeai.com'
    },
    {
      id: 'mistral',
      name: 'Mistral',
      model: 'mistral-ocr-latest',
      apiKey: '',
      apiHost: 'https://api.mistral.ai'
    }
  ],
  defaultProvider: 'mineru'
}
const preprocessSlice = createSlice({
  name: 'preprocess',
  initialState,
  reducers: {
    setDefaultPreprocessProvider(state, action: PayloadAction<string>) {
      state.defaultProvider = action.payload
    },
    setPreprocessProviders(state, action: PayloadAction<PreprocessProvider[]>) {
      state.providers = action.payload
    },
    updatePreprocessProviders(state, action: PayloadAction<PreprocessProvider[]>) {
      state.providers = action.payload
    },
    updatePreprocessProvider(state, action: PayloadAction<Partial<PreprocessProvider>>) {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        Object.assign(state.providers[index], action.payload)
      }
    }
  }
})

export const {
  updatePreprocessProviders,
  updatePreprocessProvider,
  setDefaultPreprocessProvider,
  setPreprocessProviders
} = preprocessSlice.actions

export default preprocessSlice.reducer
