import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type ToolOrder = {
  visible: string[]
  hidden: string[]
}

export const DEFAULT_TOOL_ORDER: ToolOrder = {
  visible: [
    'new_topic',
    'attachment',
    'thinking',
    'web_search',
    'url_context',
    'knowledge_base',
    'mcp_tools',
    'generate_image',
    'mention_models'
  ],
  hidden: ['quick_phrases', 'clear_topic', 'toggle_expand', 'new_context']
}

export type InputToolsState = {
  toolOrder: ToolOrder
  isCollapsed: boolean
}

const initialState: InputToolsState = {
  toolOrder: DEFAULT_TOOL_ORDER,
  isCollapsed: true
}

const inputToolsSlice = createSlice({
  name: 'inputTools',
  initialState,
  reducers: {
    setToolOrder: (state, action: PayloadAction<ToolOrder>) => {
      state.toolOrder = action.payload
    },
    setIsCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isCollapsed = action.payload
    }
  }
})

export const { setToolOrder, setIsCollapsed } = inputToolsSlice.actions

export default inputToolsSlice.reducer
