import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { nanoid } from '@reduxjs/toolkit'
import { MinAppType } from '@renderer/types'

export interface Tab {
  id: string
  type: 'page' | 'minapp'
  title: string
  icon?: string // Only allow serializable string icons (e.g., emojis or icon names)
  route?: string
  minapp?: MinAppType
  instanceId: string
  state?: Record<string, any>
  isActive: boolean
  isPinned: boolean
  canClose: boolean
  createdAt: number
  lastActiveAt: number
  groupId?: string
}

export interface TabGroup {
  id: string
  name: string
  color: string
  isCollapsed: boolean
  createdAt: number
}

interface TabsState {
  tabs: Tab[]
  groups: TabGroup[]
  activeTabId: string | null
  tabOrder: string[]
  closedTabs: Tab[] // For reopening closed tabs
}

const initialState: TabsState = {
  tabs: [],
  groups: [],
  activeTabId: null,
  tabOrder: [],
  closedTabs: []
}

// Singleton routes that should only have one instance
const SINGLETON_ROUTES = ['/settings', '/settings/*']

// Predefined color palette for tab groups
export const GROUP_COLORS = [
  '#E53E3E', // Red
  '#DD6B20', // Orange
  '#D69E2E', // Yellow
  '#38A169', // Green
  '#3182CE', // Blue
  '#805AD5', // Purple
  '#D53F8C', // Pink
  '#718096' // Gray
]

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    openTab: (
      state,
      action: PayloadAction<Omit<Tab, 'id' | 'instanceId' | 'isActive' | 'createdAt' | 'lastActiveAt'>>
    ) => {
      const tabConfig = action.payload

      // Check if this is a singleton route
      if (tabConfig.type === 'page' && tabConfig.route) {
        const isSingleton = SINGLETON_ROUTES.some((route) => {
          if (route.endsWith('/*')) {
            const baseRoute = route.slice(0, -2)
            return tabConfig.route?.startsWith(baseRoute)
          }
          return route === tabConfig.route
        })

        if (isSingleton) {
          // Find existing tab for this route
          const existingTab = state.tabs.find((tab) => tab.type === 'page' && tab.route === tabConfig.route)

          if (existingTab) {
            // Just switch to existing tab
            state.tabs.forEach((tab) => (tab.isActive = false))
            existingTab.isActive = true
            existingTab.lastActiveAt = Date.now()
            state.activeTabId = existingTab.id
            return
          }
        }
      }

      // Create new tab
      const newTab: Tab = {
        ...tabConfig,
        id: nanoid(),
        instanceId: nanoid(),
        isActive: false,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      }

      // Deactivate all tabs
      state.tabs.forEach((tab) => (tab.isActive = false))

      // Add new tab
      state.tabs.push(newTab)
      state.tabOrder.push(newTab.id)

      // Activate the new tab
      newTab.isActive = true
      state.activeTabId = newTab.id
    },

    closeTab: (state, action: PayloadAction<string>) => {
      const tabId = action.payload
      const tabIndex = state.tabs.findIndex((t) => t.id === tabId)

      if (tabIndex !== -1) {
        const closedTab = state.tabs[tabIndex]

        // Add to closed tabs history (keep last 10)
        state.closedTabs.unshift(closedTab)
        if (state.closedTabs.length > 10) {
          state.closedTabs.pop()
        }

        // Remove tab
        state.tabs.splice(tabIndex, 1)
        state.tabOrder = state.tabOrder.filter((id) => id !== tabId)

        // If closed tab was active, activate adjacent tab
        if (state.activeTabId === tabId && state.tabs.length > 0) {
          const newActiveIndex = Math.min(tabIndex, state.tabs.length - 1)
          const newActiveTab = state.tabs[newActiveIndex]
          newActiveTab.isActive = true
          newActiveTab.lastActiveAt = Date.now()
          state.activeTabId = newActiveTab.id
        } else if (state.tabs.length === 0) {
          state.activeTabId = null
        }
      }
    },

    closeOtherTabs: (state, action: PayloadAction<string>) => {
      const keepTabId = action.payload
      const keepTab = state.tabs.find((t) => t.id === keepTabId)

      if (keepTab) {
        // Add all other tabs to closed history
        const closedTabs = state.tabs.filter((t) => t.id !== keepTabId && t.canClose)
        state.closedTabs.unshift(...closedTabs)
        if (state.closedTabs.length > 10) {
          state.closedTabs = state.closedTabs.slice(0, 10)
        }

        // Keep only the specified tab and uncloseable tabs
        state.tabs = state.tabs.filter((t) => t.id === keepTabId || !t.canClose)
        state.tabOrder = state.tabOrder.filter((id) => state.tabs.some((t) => t.id === id))

        // Ensure the kept tab is active
        state.tabs.forEach((tab) => (tab.isActive = false))
        keepTab.isActive = true
        keepTab.lastActiveAt = Date.now()
        state.activeTabId = keepTab.id
      }
    },

    closeTabsToTheRight: (state, action: PayloadAction<string>) => {
      const pivotTabId = action.payload
      const pivotIndex = state.tabOrder.indexOf(pivotTabId)

      if (pivotIndex !== -1) {
        const tabsToClose = state.tabOrder.slice(pivotIndex + 1)
        const closedTabs = state.tabs.filter((t) => tabsToClose.includes(t.id) && t.canClose)

        // Add to closed history
        state.closedTabs.unshift(...closedTabs)
        if (state.closedTabs.length > 10) {
          state.closedTabs = state.closedTabs.slice(0, 10)
        }

        // Remove tabs
        state.tabs = state.tabs.filter((t) => !tabsToClose.includes(t.id) || !t.canClose)
        state.tabOrder = state.tabOrder.filter((id) => state.tabs.some((t) => t.id === id))
      }
    },

    switchTab: (state, action: PayloadAction<string>) => {
      const targetTabId = action.payload
      const targetTab = state.tabs.find((t) => t.id === targetTabId)

      if (targetTab) {
        state.tabs.forEach((tab) => (tab.isActive = false))
        targetTab.isActive = true
        targetTab.lastActiveAt = Date.now()
        state.activeTabId = targetTabId
      }
    },

    switchToNextTab: (state) => {
      if (state.tabs.length <= 1) return

      const currentIndex = state.tabOrder.indexOf(state.activeTabId || '')
      const nextIndex = (currentIndex + 1) % state.tabs.length
      const nextTabId = state.tabOrder[nextIndex]

      if (nextTabId) {
        state.tabs.forEach((tab) => (tab.isActive = false))
        const nextTab = state.tabs.find((t) => t.id === nextTabId)
        if (nextTab) {
          nextTab.isActive = true
          nextTab.lastActiveAt = Date.now()
          state.activeTabId = nextTabId
        }
      }
    },

    switchToPreviousTab: (state) => {
      if (state.tabs.length <= 1) return

      const currentIndex = state.tabOrder.indexOf(state.activeTabId || '')
      const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length
      const prevTabId = state.tabOrder[prevIndex]

      if (prevTabId) {
        state.tabs.forEach((tab) => (tab.isActive = false))
        const prevTab = state.tabs.find((t) => t.id === prevTabId)
        if (prevTab) {
          prevTab.isActive = true
          prevTab.lastActiveAt = Date.now()
          state.activeTabId = prevTabId
        }
      }
    },

    updateTab: (state, action: PayloadAction<{ id: string; updates: Partial<Tab> }>) => {
      const { id, updates } = action.payload
      const tab = state.tabs.find((t) => t.id === id)
      if (tab) {
        Object.assign(tab, updates)
      }
    },

    reorderTabs: (state, action: PayloadAction<string[]>) => {
      state.tabOrder = action.payload
    },

    pinTab: (state, action: PayloadAction<string>) => {
      const tab = state.tabs.find((t) => t.id === action.payload)
      if (tab) {
        tab.isPinned = true
        // Move pinned tabs to the beginning
        const pinnedTabs = state.tabOrder.filter((id) => {
          const t = state.tabs.find((tab) => tab.id === id)
          return t?.isPinned
        })
        const unpinnedTabs = state.tabOrder.filter((id) => {
          const t = state.tabs.find((tab) => tab.id === id)
          return !t?.isPinned
        })
        state.tabOrder = [...pinnedTabs, ...unpinnedTabs]
      }
    },

    unpinTab: (state, action: PayloadAction<string>) => {
      const tab = state.tabs.find((t) => t.id === action.payload)
      if (tab) {
        tab.isPinned = false
      }
    },

    reopenClosedTab: (state) => {
      if (state.closedTabs.length > 0) {
        const tabToReopen = state.closedTabs.shift()
        if (tabToReopen) {
          // Reset tab properties
          tabToReopen.isActive = false
          tabToReopen.createdAt = Date.now()
          tabToReopen.lastActiveAt = Date.now()

          // Deactivate all tabs
          state.tabs.forEach((tab) => (tab.isActive = false))

          // Add reopened tab
          state.tabs.push(tabToReopen)
          state.tabOrder.push(tabToReopen.id)

          // Activate it
          tabToReopen.isActive = true
          state.activeTabId = tabToReopen.id
        }
      }
    },

    updateTabState: (state, action: PayloadAction<{ id: string; tabState: any }>) => {
      const { id, tabState } = action.payload
      const tab = state.tabs.find((t) => t.id === id)
      if (tab) {
        tab.state = { ...tab.state, ...tabState }
      }
    },

    // Tab Group Actions
    createGroup: (state, action: PayloadAction<{ name: string; color?: string }>) => {
      const { name, color } = action.payload
      const newGroup: TabGroup = {
        id: nanoid(),
        name,
        color: color || GROUP_COLORS[state.groups.length % GROUP_COLORS.length],
        isCollapsed: false,
        createdAt: Date.now()
      }
      state.groups.push(newGroup)
    },

    updateGroup: (state, action: PayloadAction<{ id: string; updates: Partial<TabGroup> }>) => {
      const { id, updates } = action.payload
      const group = state.groups.find((g) => g.id === id)
      if (group) {
        Object.assign(group, updates)
      }
    },

    deleteGroup: (state, action: PayloadAction<string>) => {
      const groupId = action.payload
      // Remove group
      state.groups = state.groups.filter((g) => g.id !== groupId)
      // Remove groupId from all tabs
      state.tabs.forEach((tab) => {
        if (tab.groupId === groupId) {
          delete tab.groupId
        }
      })
    },

    toggleGroupCollapse: (state, action: PayloadAction<string>) => {
      const group = state.groups.find((g) => g.id === action.payload)
      if (group) {
        group.isCollapsed = !group.isCollapsed
      }
    },

    addTabToGroup: (state, action: PayloadAction<{ tabId: string; groupId: string }>) => {
      const { tabId, groupId } = action.payload
      const tab = state.tabs.find((t) => t.id === tabId)
      const group = state.groups.find((g) => g.id === groupId)
      if (tab && group) {
        tab.groupId = groupId
      }
    },

    removeTabFromGroup: (state, action: PayloadAction<string>) => {
      const tab = state.tabs.find((t) => t.id === action.payload)
      if (tab) {
        delete tab.groupId
      }
    }
  }
})

export const {
  openTab,
  closeTab,
  closeOtherTabs,
  closeTabsToTheRight,
  switchTab,
  switchToNextTab,
  switchToPreviousTab,
  updateTab,
  reorderTabs,
  pinTab,
  unpinTab,
  reopenClosedTab,
  updateTabState,
  createGroup,
  updateGroup,
  deleteGroup,
  toggleGroupCollapse,
  addTabToGroup,
  removeTabFromGroup
} = tabsSlice.actions

export default tabsSlice.reducer
