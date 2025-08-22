import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { MinAppType } from '@renderer/types'

export interface MinAppsState {
  enabled: MinAppType[]
  disabled: MinAppType[]
  pinned: MinAppType[]
}

const initialState: MinAppsState = {
  enabled: DEFAULT_MIN_APPS,
  disabled: [],
  pinned: []
}

const minAppsSlice = createSlice({
  name: 'minApps',
  initialState,
  reducers: {
    setMinApps: (state, action: PayloadAction<MinAppType[]>) => {
      state.enabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    addMinApp: (state, action: PayloadAction<MinAppType>) => {
      state.enabled.push(action.payload)
    },
    setDisabledMinApps: (state, action: PayloadAction<MinAppType[]>) => {
      state.disabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    setPinnedMinApps: (state, action: PayloadAction<MinAppType[]>) => {
      state.pinned = action.payload.map((app) => ({ ...app, logo: undefined }))
    }
  }
})

export const { setMinApps, addMinApp, setDisabledMinApps, setPinnedMinApps } = minAppsSlice.actions

export default minAppsSlice.reducer
