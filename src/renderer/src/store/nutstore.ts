import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { WebDAVSyncState } from './backup'

export interface NutstoreSyncState extends WebDAVSyncState {}

export interface NutstoreState {
  nutstoreToken: string | null
  nutstorePath: string
  nutstoreAutoSync: boolean
  nutstoreSyncInterval: number
  nutstoreSyncState: NutstoreSyncState
}

const initialState: NutstoreState = {
  nutstoreToken: '',
  nutstorePath: '/cherry-studio',
  nutstoreAutoSync: false,
  nutstoreSyncInterval: 0,
  nutstoreSyncState: {
    lastSyncTime: null,
    syncing: false,
    lastSyncError: null
  }
}

const nutstoreSlice = createSlice({
  name: 'nutstore',
  initialState,
  reducers: {
    setNutstoreToken: (state, action: PayloadAction<string>) => {
      state.nutstoreToken = action.payload
    },
    setNutstorePath: (state, action: PayloadAction<string>) => {
      console.log(state, action.payload)
      state.nutstorePath = action.payload
    },
    setNutstoreAutoSync: (state, action: PayloadAction<boolean>) => {
      state.nutstoreAutoSync = action.payload
    },
    setNutstoreSyncInterval: (state, action: PayloadAction<number>) => {
      state.nutstoreSyncInterval = action.payload
    },
    setNutstoreSyncState: (state, action: PayloadAction<Partial<WebDAVSyncState>>) => {
      state.nutstoreSyncState = { ...state.nutstoreSyncState, ...action.payload }
    }
  }
})

export const { setNutstoreToken, setNutstorePath, setNutstoreAutoSync, setNutstoreSyncInterval, setNutstoreSyncState } =
  nutstoreSlice.actions

export default nutstoreSlice.reducer
