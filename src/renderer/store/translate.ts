/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * Runtime reads / dispatches of this slice have all been migrated to
 * `useCache('translate.*')` and `usePreference('feature.translate.*')`.
 * It is retained (and still combined into the root reducer) for exactly one
 * reason: the redux-persist migrations at versions 137 and 152 assign into
 * `state.translate.*`, and removing the slice before a compatible persist
 * version bump would break state rehydration for users upgrading from older
 * versions. Final removal must land together with a migration that deletes
 * `state.translate` from persisted state and a redux-persist version bump.
 *
 * STOP: Do NOT add new actions, selectors, or field consumers here.
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
