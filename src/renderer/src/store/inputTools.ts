import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { InputbarScope } from '@renderer/pages/home/Inputbar/types'
import { TopicType } from '@renderer/types'
import type { InputBarToolType } from '@renderer/types/chat'

type ToolOrder = {
  visible: InputBarToolType[]
  hidden: InputBarToolType[]
}

/**
 * @deprecated Use DEFAULT_TOOL_ORDER_BY_SCOPE instead
 */
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

// Default tool order per scope
// Note: New tools not listed here will auto-show at the end.
// Tools are filtered by visibleInScopes first, so this only controls order/visibility of available tools.
export const DEFAULT_TOOL_ORDER_BY_SCOPE: Record<InputbarScope, ToolOrder> = {
  [TopicType.Chat]: DEFAULT_TOOL_ORDER,
  [TopicType.Session]: {
    visible: ['create_session', 'slash_commands', 'attachment'],
    hidden: []
  },
  'mini-window': {
    visible: ['attachment', 'mention_models', 'quick_phrases'],
    hidden: []
  }
}

type InputToolsState = {
  toolOrder: Partial<Record<InputbarScope, ToolOrder>>
  isCollapsed: boolean
}

const initialState: InputToolsState = {
  toolOrder: DEFAULT_TOOL_ORDER_BY_SCOPE,
  isCollapsed: true
}

const inputToolsSlice = createSlice({
  name: 'inputTools',
  initialState,
  reducers: {
    setToolOrder: (state, action: PayloadAction<{ scope: InputbarScope; toolOrder: ToolOrder }>) => {
      state.toolOrder[action.payload.scope] = action.payload.toolOrder
    },
    setIsCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isCollapsed = action.payload
    }
  }
})

export const { setToolOrder, setIsCollapsed } = inputToolsSlice.actions

// Selector to get tool order for a specific scope
export const selectToolOrderForScope = (state: { inputTools: InputToolsState }, scope: InputbarScope): ToolOrder => {
  return state.inputTools.toolOrder[scope] ?? DEFAULT_TOOL_ORDER_BY_SCOPE[scope] ?? DEFAULT_TOOL_ORDER
}

export default inputToolsSlice.reducer
