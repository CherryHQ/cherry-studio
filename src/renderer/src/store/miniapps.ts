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
import { allMiniApps, type MiniAppType } from '@renderer/config/miniapps'

export interface MinAppsState {
  enabled: MiniAppType[]
  disabled: MiniAppType[]
  pinned: MiniAppType[]
}

const initialState: MinAppsState = {
  enabled: allMiniApps,
  disabled: [],
  pinned: []
}

const minAppsSlice = createSlice({
  name: 'minApps',
  initialState,
  reducers: {
    setMinApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.enabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    addMinApp: (state, action: PayloadAction<MiniAppType>) => {
      state.enabled.push(action.payload)
    },
    setDisabledMinApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.disabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    setPinnedMinApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.pinned = action.payload.map((app) => ({ ...app, logo: undefined }))
    }
  }
})

export const { setMinApps, addMinApp, setDisabledMinApps, setPinnedMinApps } = minAppsSlice.actions

export default minAppsSlice.reducer
