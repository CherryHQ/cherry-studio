import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Extension } from '@shared/config/types'

export interface ExtensionsState {
  extensions: Extension[]
}

const initialState: ExtensionsState = {
  extensions: []
}

const extensionsSlice = createSlice({
  name: 'extensions',
  initialState,
  reducers: {
    setExtensions: (state, action: PayloadAction<Extension[]>) => {
      state.extensions = action.payload
    },
    addExtension: (state, action: PayloadAction<Extension>) => {
      state.extensions.push(action.payload)
    },
    removeExtension: (state, action: PayloadAction<string>) => {
      state.extensions = state.extensions.filter((ext) => ext.id !== action.payload)
    },
    updateExtension: (state, action: PayloadAction<Extension>) => {
      const index = state.extensions.findIndex((ext) => ext.id === action.payload.id)
      if (index !== -1) {
        state.extensions[index] = action.payload
      }
    },
    toggleExtensionEnabled: (state, action: PayloadAction<string>) => {
      const extension = state.extensions.find((ext) => ext.id === action.payload)
      if (extension) {
        extension.enabled = !extension.enabled
      }
    },
    updateExtensionState: (state, action: PayloadAction<{ extensionId: string; enabled: boolean }>) => {
      const extension = state.extensions.find((ext) => ext.id === action.payload.extensionId)
      if (extension) {
        extension.enabled = action.payload.enabled
      }
    }
  }
})

export const {
  setExtensions,
  addExtension,
  removeExtension,
  updateExtension,
  toggleExtensionEnabled,
  updateExtensionState
} = extensionsSlice.actions

export default extensionsSlice.reducer
