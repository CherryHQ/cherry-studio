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

export interface TranslateState {
  translateInput: string
  translatedContent: string
  // TODO: #9749
  settings: {
    autoCopy: boolean
  }
}

const initialState: TranslateState = {
  translateInput: '',
  translatedContent: '',
  settings: {
    autoCopy: false
  }
} as const

const translateSlice = createSlice({
  name: 'translate',
  initialState,
  reducers: {
    setTranslateInput: (state, action: PayloadAction<string>) => {
      state.translateInput = action.payload
    },
    setTranslatedContent: (state, action: PayloadAction<string>) => {
      state.translatedContent = action.payload
    },
    updateSettings: (state, action: PayloadAction<Partial<TranslateState['settings']>>) => {
      const update = action.payload
      Object.assign(state.settings, update)
    }
  }
})

export const { setTranslateInput, setTranslatedContent, updateSettings } = translateSlice.actions

export default translateSlice.reducer
