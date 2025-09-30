import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import ApplicationLogo from '@renderer/assets/images/apps/application.png?url'
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
      const incoming = action.payload
      const item: MinAppType = {
        ...incoming,
        logo: incoming.logo && incoming.logo !== '' ? incoming.logo : ApplicationLogo
      }
      // de-duplicate by id and upsert
      state.enabled = state.enabled.filter((app) => app.id !== item.id)
      state.enabled.push(item)
    },
    removeMinApp: (state, action: PayloadAction<string | MinAppType>) => {
      const id = typeof action.payload === 'string' ? action.payload : action.payload.id
      state.enabled = state.enabled.filter((app) => app.id !== id)
      state.disabled = state.disabled.filter((app) => app.id !== id)
      state.pinned = state.pinned.filter((app) => app.id !== id)
    },
    setDisabledMinApps: (state, action: PayloadAction<MinAppType[]>) => {
      state.disabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    setPinnedMinApps: (state, action: PayloadAction<MinAppType[]>) => {
      state.pinned = action.payload.map((app) => ({ ...app, logo: undefined }))
    }
  }
})

export const { setMinApps, addMinApp, removeMinApp, setDisabledMinApps, setPinnedMinApps } = minAppsSlice.actions

export default minAppsSlice.reducer
