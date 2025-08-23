import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { BUILTIN_OCR_PROVIDERS, DEFAULT_OCR_PROVIDER } from '@renderer/config/ocr'
import { ImageOcrProvider, OcrProvider, OcrProviderConfig } from '@renderer/types'

export interface OcrState {
  providers: OcrProvider[]
  imageProvider: ImageOcrProvider
}

const initialState: OcrState = {
  providers: BUILTIN_OCR_PROVIDERS,
  imageProvider: DEFAULT_OCR_PROVIDER.image
}

const ocrSlice = createSlice({
  name: 'ocr',
  initialState,
  reducers: {
    setOcrProviders(state, action: PayloadAction<OcrProvider[]>) {
      state.providers = action.payload
    },
    addOcrProvider(state, action: PayloadAction<OcrProvider>) {
      state.providers.push(action.payload)
    },
    removeOcrProvider(state, action: PayloadAction<string>) {
      state.providers = state.providers.filter((provider) => provider.id !== action.payload)
    },
    updateOcrProvider(state, action: PayloadAction<Partial<OcrProvider>>) {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        Object.assign(state.providers[index], action.payload)
      }
    },
    updateOcrProviderConfig(
      state,
      action: PayloadAction<{ id: string; update: Omit<Partial<OcrProviderConfig>, 'id'> }>
    ) {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        if (!state.providers[index].config) {
          state.providers[index].config = {}
        }
        Object.assign(state.providers[index].config, action.payload.update)
      }
    },
    setImageOcrProvider(state, action: PayloadAction<ImageOcrProvider>) {
      state.imageProvider = action.payload
    }
  }
})

export const {
  setOcrProviders,
  addOcrProvider,
  removeOcrProvider,
  updateOcrProvider,
  updateOcrProviderConfig,
  setImageOcrProvider
} = ocrSlice.actions

export default ocrSlice.reducer
