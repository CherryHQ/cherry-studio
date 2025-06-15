import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { LangfuseSettings, TraceProviderType } from '@renderer/types/trace'

export interface TraceState {
  enabled: boolean
  provider: TraceProviderType
  langfuse: LangfuseSettings
}

const initialState: TraceState = {
  enabled: false,
  provider: 'langfuse',
  langfuse: {
    baseUrl: 'https://cloud.langfuse.com',
    publicKey: '',
    secretKey: ''
  }
}

const traceSlice = createSlice({
  name: 'trace',
  initialState,
  reducers: {
    setEnabled: (state, action: PayloadAction<boolean>) => {
      state.enabled = action.payload
    },
    setProvider: (state, action: PayloadAction<TraceProviderType>) => {
      state.provider = action.payload
    },
    updateLangfuse: (state, action: PayloadAction<Partial<LangfuseSettings>>) => {
      state.langfuse = { ...state.langfuse, ...action.payload }
    }
  }
})

export const { setEnabled, setProvider, updateLangfuse } = traceSlice.actions
export default traceSlice.reducer
