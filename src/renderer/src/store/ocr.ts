import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { BUILTIN_OCR_PROVIDERS, DEFAULT_OCR_PROVIDER } from '@renderer/config/ocr'
import { ImageOcrProvider, OcrProvider } from '@renderer/types/ocr'

export interface OcrState {
  providers: OcrProvider[]
  imageProvider: OcrProvider
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
    removeOcrProvider(state, action: PayloadAction<OcrProvider>) {
      state.providers = state.providers.filter((provider) => provider.id !== action.payload.id)
    },
    updateOcrProvider(state, action: PayloadAction<Partial<OcrProvider>>) {
      const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
      if (index !== -1) {
        Object.assign(state.providers[index], action.payload)
      }
    },
    setImageOcrProvider(state, action: PayloadAction<ImageOcrProvider>) {
      state.imageProvider = action.payload
    }
  }
})

export const { setOcrProviders, addOcrProvider, removeOcrProvider, updateOcrProvider, setImageOcrProvider } =
  ocrSlice.actions

export default ocrSlice.reducer
