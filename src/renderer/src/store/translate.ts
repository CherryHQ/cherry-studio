import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface TranslateState {
  translatedContent: string
}

const initialState: TranslateState = {
  translatedContent: ''
}

const translateSlice = createSlice({
  name: 'translate',
  initialState,
  reducers: {
    setTranslatedContent: (state, action: PayloadAction<string>) => {
      return {
        ...state,
        translatedContent: action.payload
      }
    }
  }
})

export const { setTranslatedContent } = translateSlice.actions

export default translateSlice.reducer
