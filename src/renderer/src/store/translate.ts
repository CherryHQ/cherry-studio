import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface TranslateState {
  translateInput: string
  translatedContent: string
}

const initialState: TranslateState = {
  translateInput: '',
  translatedContent: ''
}

const translateSlice = createSlice({
  name: 'translate',
  initialState,
  reducers: {
    setTranslateInput: (state, action: PayloadAction<string>) => {
      state.translateInput = action.payload
    },
    setTranslatedContent: (state, action: PayloadAction<string>) => {
      state.translatedContent = action.payload
    }
  }
})

export const { setTranslateInput, setTranslatedContent } = translateSlice.actions

export default translateSlice.reducer
