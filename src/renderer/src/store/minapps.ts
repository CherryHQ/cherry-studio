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
import { allMinApps } from '@renderer/config/minapps'
import type { MinAppType } from '@renderer/types'

export interface MinAppsState {
  enabled: MinAppType[]
  disabled: MinAppType[]
  pinned: MinAppType[]
  // Display settings
  iconOnly: boolean
  categoryColumns: number
}

const initialState: MinAppsState = {
  enabled: allMinApps,
  disabled: [],
  pinned: [],
  iconOnly: false,
  categoryColumns: 1
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
    },
    moveMinApp: (
      state,
      action: PayloadAction<{
        appId: string
        from: 'enabled' | 'disabled' | 'pinned'
        to: 'enabled' | 'disabled' | 'pinned'
      }>
    ) => {
      const { appId, from, to } = action.payload
      if (from === to) return

      const sourceList = state[from]
      const appIndex = sourceList.findIndex((app) => app.id === appId)
      if (appIndex === -1) return

      const [app] = sourceList.splice(appIndex, 1)
      state[to].push({ ...app, logo: undefined })
    },
    setIconOnly: (state, action: PayloadAction<boolean>) => {
      state.iconOnly = action.payload
    },
    setCategoryColumns: (state, action: PayloadAction<number>) => {
      state.categoryColumns = action.payload
    }
  }
})

export const {
  setMinApps,
  addMinApp,
  setDisabledMinApps,
  setPinnedMinApps,
  moveMinApp,
  setIconOnly,
  setCategoryColumns
} = minAppsSlice.actions

export default minAppsSlice.reducer
