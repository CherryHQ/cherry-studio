/** @deprecated All migrated. */
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
    // setTranslateInput: (state, action: PayloadAction<string>) => {
    //   state.translateInput = action.payload
    // },
    // setTranslatedContent: (state, action: PayloadAction<string>) => {
    //   state.translatedContent = action.payload
    // },
    // updateSettings: (state, action: PayloadAction<Partial<TranslateState['settings']>>) => {
    //   const update = action.payload
    //   Object.assign(state.settings, update)
    // }
  }
})

export default translateSlice.reducer
