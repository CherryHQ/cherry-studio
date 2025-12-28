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

export interface Tab {
  id: string
  path: string
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}

const initialState: TabsState = {
  tabs: [
    {
      id: 'home',
      path: '/'
    }
  ],
  activeTabId: 'home'
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    setTabs: (state, action: PayloadAction<Tab[]>) => {
      state.tabs = action.payload
    },
    addTab: (state, action: PayloadAction<Tab>) => {
      const existingTab = state.tabs.find((tab) => tab.path === action.payload.path)
      if (!existingTab) {
        state.tabs.push(action.payload)
      }
      state.activeTabId = action.payload.id
    },
    removeTab: (state, action: PayloadAction<string>) => {
      const index = state.tabs.findIndex((tab) => tab.id === action.payload)
      if (index !== -1) {
        state.tabs.splice(index, 1)
        // 如果关闭的是当前标签页，则切换到最后一个标签页
        if (action.payload === state.activeTabId) {
          state.activeTabId = state.tabs[state.tabs.length - 1].id
        }
      }
    },
    updateTab: (state, action: PayloadAction<{ id: string; updates: Partial<Tab> }>) => {
      const tab = state.tabs.find((tab) => tab.id === action.payload.id)
      if (tab) {
        Object.assign(tab, action.payload.updates)
      }
    },
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.activeTabId = action.payload
    }
  }
})

export const { setTabs, addTab, removeTab, setActiveTab, updateTab } = tabsSlice.actions
export default tabsSlice.reducer
