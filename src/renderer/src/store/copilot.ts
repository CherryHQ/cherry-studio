import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface CopilotState {
  username?: string
  avatar?: string
  defaultHeaders?: Record<string, string>
}

const initialState: CopilotState = {
  username: '',
  avatar: ''
}

export const copilotSlice = createSlice({
  name: 'copilot',
  initialState,
  reducers: {
    setUsername: (state, action: PayloadAction<string>) => {
      state.username = action.payload
    },
    setAvatar: (state, action: PayloadAction<string>) => {
      state.avatar = action.payload
    },
    setDefaultHeaders: (state, action: PayloadAction<Record<string, string>>) => {
      state.defaultHeaders = action.payload
    },
    updateCopilotState: (state, action: PayloadAction<Partial<CopilotState>>) => {
      return { ...state, ...action.payload }
    },
    resetCopilotState: () => initialState
  }
})

export const { setUsername, setAvatar, setDefaultHeaders, updateCopilotState, resetCopilotState } = copilotSlice.actions

export default copilotSlice.reducer
