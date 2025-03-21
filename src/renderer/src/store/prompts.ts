import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { SEARCH_SUMMARY_PROMPT, TRANSLATE_PROMPT } from '@renderer/config/prompts'

export interface PromptsState {
  searchSummaryPrompt: string
  topicNamingPrompt: string
  translateModelPrompt: string
}

const initialState: PromptsState = {
  searchSummaryPrompt: SEARCH_SUMMARY_PROMPT,
  topicNamingPrompt: '',
  translateModelPrompt: TRANSLATE_PROMPT
}

const promptsSlice = createSlice({
  name: 'prompts',
  initialState,
  reducers: {
    setSearchSummaryPrompt: (state, action: PayloadAction<string>) => {
      state.searchSummaryPrompt = action.payload
    },
    setTopicNamingPrompt: (state, action: PayloadAction<string>) => {
      state.topicNamingPrompt = action.payload
    },
    setTranslateModelPrompt: (state, action: PayloadAction<string>) => {
      state.translateModelPrompt = action.payload
    }
  }
})

export const { setTopicNamingPrompt, setSearchSummaryPrompt, setTranslateModelPrompt } = promptsSlice.actions

export default promptsSlice.reducer
