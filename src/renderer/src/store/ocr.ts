import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { OcrProvider } from '@renderer/types'

export interface OcrState {
  providers: OcrProvider[]
  defaultProvider: string
}

const initialState: OcrState = {
  providers: [
    {
      id: 'system',
      name: 'System(Mac Only)',
      options: {
        recognitionLevel: 0,
        minConfidence: 0.5
      }
    }
  ],
  defaultProvider: ''
}
const ocrSlice = createSlice({
  name: 'ocr',
  initialState,
  reducers: {
    setDefaultOcrProvider(state, action: PayloadAction<string>) {
      state.defaultProvider = action.payload
    },
    setOcrProviders(state, action: PayloadAction<OcrProvider[]>) {
      state.providers = action.payload
    },
    updateOcrProviders(state, action: PayloadAction<OcrProvider[]>) {
      state.providers = action.payload
    },
    updateOcrProvider(state, action: PayloadAction<OcrProvider>) {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        state.providers[index] = action.payload
      }
    }
  }
})

export const { updateOcrProviders, updateOcrProvider, setDefaultOcrProvider, setOcrProviders } = ocrSlice.actions

export default ocrSlice.reducer
