import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface TranslateState {
  translating: boolean
  translatedContent: string
}

const initialState: TranslateState = {
  translating: false,
  translatedContent: ''
}

const translateSlice = createSlice({
  name: 'translate',
  initialState,
  reducers: {
    setTranslating: (state, action: PayloadAction<boolean>) => {
      return {
        ...state,
        translating: action.payload
      }
    },
    setTranslatedContent: (state, action: PayloadAction<string>) => {
      return {
        ...state,
        translatedContent: action.payload
      }
    }
  }
})

export const { setTranslating, setTranslatedContent } = translateSlice.actions

export default translateSlice.reducer
