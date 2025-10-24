/** @deprecated All migrated. */
import { createSlice } from '@reduxjs/toolkit'
import type { OcrProvider } from '@renderer/types'
import { getDefaultOcrProvider } from '@renderer/utils/ocr'
import { BUILTIN_OCR_PROVIDERS } from '@shared/config/ocr'

export interface OcrState {
  providers: OcrProvider[]
  imageProviderId: string
}

const initialState: OcrState = {
  providers: BUILTIN_OCR_PROVIDERS,
  imageProviderId: getDefaultOcrProvider('image').id
}

const ocrSlice = createSlice({
  name: 'ocr',
  initialState,
  selectors: {
    getImageProvider(state) {
      return state.providers.find((p) => p.id === state.imageProviderId)
    }
  },
  reducers: {
    // setOcrProviders(state, action: PayloadAction<OcrProvider[]>) {
    //   state.providers = action.payload
    // },
    // addOcrProvider(state, action: PayloadAction<OcrProvider>) {
    //   state.providers.push(action.payload)
    // },
    // removeOcrProvider(state, action: PayloadAction<string>) {
    //   state.providers = state.providers.filter((provider) => provider.id !== action.payload)
    // },
    // updateOcrProvider(state, action: PayloadAction<Partial<OcrProvider>>) {
    //   const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
    //   if (index !== -1) {
    //     Object.assign(state.providers[index], action.payload)
    //   }
    // },
    // updateOcrProviderConfig(
    //   state,
    //   action: PayloadAction<{ id: string; update: Omit<Partial<OcrProviderConfig>, 'id'> }>
    // ) {
    //   const index = state.providers.findIndex((provider) => provider.id === action.payload.id)
    //   if (index !== -1) {
    //     if (!state.providers[index].config) {
    //       state.providers[index].config = {}
    //     }
    //     Object.assign(state.providers[index].config, action.payload.update)
    //   }
    // },
    // setImageOcrProviderId(state, action: PayloadAction<string>) {
    //   state.imageProviderId = action.payload
    // }
  }
})

// export const {
// setOcrProviders,
// addOcrProvider,
// removeOcrProvider,
// updateOcrProvider,
// updateOcrProviderConfig,
// setImageOcrProviderId
// } = ocrSlice.actions

// export const { getImageProvider } = ocrSlice.selectors

export default ocrSlice.reducer
