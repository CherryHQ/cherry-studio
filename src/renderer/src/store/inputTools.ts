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
import type { InputbarScope } from '@renderer/pages/home/Inputbar/types'
import { TopicType } from '@renderer/types'
import type { InputBarToolType } from '@renderer/types/chat'

type ToolOrder = {
  visible: InputBarToolType[]
  hidden: InputBarToolType[]
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
  toolOrder: ToolOrder
  sessionToolOrder: ToolOrder
  isCollapsed: boolean
}

const initialState: InputToolsState = {
  toolOrder: DEFAULT_TOOL_ORDER,
  sessionToolOrder: DEFAULT_TOOL_ORDER_BY_SCOPE[TopicType.Session],
  isCollapsed: true
}

const inputToolsSlice = createSlice({
  name: 'inputTools',
  initialState,
  reducers: {
    setToolOrder: (state, action: PayloadAction<{ scope: InputbarScope; toolOrder: ToolOrder }>) => {
      if (action.payload.scope === TopicType.Session) {
        state.sessionToolOrder = action.payload.toolOrder
      } else {
        state.toolOrder = action.payload.toolOrder
      }
    },
    setIsCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isCollapsed = action.payload
    }
  }
})

export const { setToolOrder, setIsCollapsed } = inputToolsSlice.actions

// Selector to get tool order for a specific scope
export const selectToolOrderForScope = (state: { inputTools: InputToolsState }, scope: InputbarScope): ToolOrder => {
  return scope === TopicType.Session ? state.inputTools.sessionToolOrder : state.inputTools.toolOrder
}

export default inputToolsSlice.reducer
