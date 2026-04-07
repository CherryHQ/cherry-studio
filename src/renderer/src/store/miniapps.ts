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
import { allMiniApps } from '@renderer/config/miniapps'
import type { MiniAppType } from '@shared/data/types/miniapp'

export interface MiniAppsState {
  enabled: MiniAppType[]
  disabled: MiniAppType[]
  pinned: MiniAppType[]
}

const initialState: MiniAppsState = {
  enabled: allMiniApps,
  disabled: [],
  pinned: []
}

const miniAppsSlice = createSlice({
  name: 'miniApps',
  initialState,
  reducers: {
    setMiniApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.enabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    addMiniApp: (state, action: PayloadAction<MiniAppType>) => {
      state.enabled.push(action.payload)
    },
    setDisabledMiniApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.disabled = action.payload.map((app) => ({ ...app, logo: undefined }))
    },
    setPinnedMiniApps: (state, action: PayloadAction<MiniAppType[]>) => {
      state.pinned = action.payload.map((app) => ({ ...app, logo: undefined }))
    }
  }
})

export const { setMiniApps, addMiniApp, setDisabledMiniApps, setPinnedMiniApps } = miniAppsSlice.actions

export default miniAppsSlice.reducer
