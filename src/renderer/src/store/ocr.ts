/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import { BUILTIN_OCR_PROVIDERS, DEFAULT_OCR_PROVIDER } from '@renderer/config/ocr'
import type { OcrProvider, OcrProviderConfig } from '@renderer/types'

export interface OcrState {
  providers: OcrProvider[]
  imageProviderId: string
}

const initialState: OcrState = {
  providers: BUILTIN_OCR_PROVIDERS,
  imageProviderId: DEFAULT_OCR_PROVIDER.image.id
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
    setImageOcrProviderId(state, action: PayloadAction<string>) {
      state.imageProviderId = action.payload
    }
  }
})

export const {
  setOcrProviders,
  addOcrProvider,
  removeOcrProvider,
  updateOcrProvider,
  updateOcrProviderConfig,
  setImageOcrProviderId
} = ocrSlice.actions

export const { getImageProvider } = ocrSlice.selectors

export default ocrSlice.reducer
