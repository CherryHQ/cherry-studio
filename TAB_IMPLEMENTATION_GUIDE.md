# Tab System Implementation Guide

## Quick Start Implementation

### Step 1: Create Tab Redux Slice

```typescript
// src/renderer/src/store/tabs.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { nanoid } from 'nanoid'

export interface Tab {
  id: string
  type: 'page' | 'minapp'
  title: string
  icon?: string
  route?: string
  minapp?: MinAppType
  instanceId: string
  state?: Record<string, any>
  isActive: boolean
  isPinned: boolean
  canClose: boolean
  createdAt: number
  lastActiveAt: number
}

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
  tabOrder: string[]
}

const initialState: TabsState = {
  tabs: [],
  activeTabId: null,
  tabOrder: []
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    openTab: (state, action: PayloadAction<Partial<Tab>>) => {
      const newTab: Tab = {
        id: nanoid(),
        instanceId: nanoid(),
        isActive: false,
        isPinned: false,
        canClose: true,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        ...action.payload
      }
      
      state.tabs.push(newTab)
      state.tabOrder.push(newTab.id)
      
      // Activate the new tab
      state.tabs.forEach(tab => tab.isActive = false)
      newTab.isActive = true
      state.activeTabId = newTab.id
    },
    
    closeTab: (state, action: PayloadAction<string>) => {
      const tabId = action.payload
      const tabIndex = state.tabs.findIndex(t => t.id === tabId)
      
      if (tabIndex !== -1) {
        state.tabs.splice(tabIndex, 1)
        state.tabOrder = state.tabOrder.filter(id => id !== tabId)
        
        // Activate previous tab if closed tab was active
        if (state.activeTabId === tabId && state.tabs.length > 0) {
          const newActiveTab = state.tabs[Math.max(0, tabIndex - 1)]
          newActiveTab.isActive = true
          state.activeTabId = newActiveTab.id
        }
      }
    },
    
    switchTab: (state, action: PayloadAction<string>) => {
      state.tabs.forEach(tab => {
        tab.isActive = tab.id === action.payload
        if (tab.isActive) {
          tab.lastActiveAt = Date.now()
        }
      })
      state.activeTabId = action.payload
    },
    
    updateTab: (state, action: PayloadAction<{ id: string; updates: Partial<Tab> }>) => {
      const tab = state.tabs.find(t => t.id === action.payload.id)
      if (tab) {
        Object.assign(tab, action.payload.updates)
      }
    },
    
    reorderTabs: (state, action: PayloadAction<string[]>) => {
      state.tabOrder = action.payload
    }
  }
})

export const { openTab, closeTab, switchTab, updateTab, reorderTabs } = tabsSlice.actions
export default tabsSlice.reducer
```

### Step 2: Create Tab Bar Component

```tsx
// src/renderer/src/components/TabBar/TabBar.tsx
import React, { useRef } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { closeTab, switchTab, reorderTabs } from '@renderer/store/tabs'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import styled from 'styled-components'
import TabItem from './TabItem'

const TabBar: React.FC = () => {
  const dispatch = useAppDispatch()
  const { tabs, tabOrder, activeTabId } = useAppSelector(state => state.tabs)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      const oldIndex = tabOrder.indexOf(active.id as string)
      const newIndex = tabOrder.indexOf(over?.id as string)
      
      const newOrder = [...tabOrder]
      newOrder.splice(oldIndex, 1)
      newOrder.splice(newIndex, 0, active.id as string)
      
      dispatch(reorderTabs(newOrder))
    }
  }

  const handleNewTab = () => {
    dispatch(openTab({
      type: 'page',
      route: '/',
      title: 'New Tab'
    }))
  }

  return (
    <Container ref={containerRef}>
      <TabsWrapper>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
            {tabOrder.map(tabId => {
              const tab = tabs.find(t => t.id === tabId)
              if (!tab) return null
              
              return (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onClose={() => dispatch(closeTab(tab.id))}
                  onClick={() => dispatch(switchTab(tab.id))}
                />
              )
            })}
          </SortableContext>
        </DndContext>
      </TabsWrapper>
      
      <NewTabButton onClick={handleNewTab}>
        <PlusIcon />
      </NewTabButton>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  align-items: center;
  height: 40px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
  padding: 0 8px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`

const TabsWrapper = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
`

const NewTabButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background: var(--color-background-hover);
  }
`

export default TabBar
```

### Step 3: Create Tab Content Manager

```tsx
// src/renderer/src/components/TabContentManager.tsx
import React, { Suspense, lazy } from 'react'
import { useAppSelector } from '@renderer/store'
import { AnimatePresence, motion } from 'framer-motion'
import MinappWebviewContainer from './MinApp/MinappWebviewContainer'

// Lazy load page components
const HomePage = lazy(() => import('@renderer/pages/home/HomePage'))
const AgentsPage = lazy(() => import('@renderer/pages/agents/AgentsPage'))
const TranslatePage = lazy(() => import('@renderer/pages/translate/TranslatePage'))
// ... other pages

const TabContentManager: React.FC = () => {
  const { tabs, activeTabId } = useAppSelector(state => state.tabs)
  const activeTab = tabs.find(tab => tab.id === activeTabId)

  if (!activeTab) return null

  const renderTabContent = () => {
    if (activeTab.type === 'minapp' && activeTab.minapp) {
      return (
        <MinappWebviewContainer
          key={activeTab.instanceId}
          app={activeTab.minapp}
          tabId={activeTab.id}
        />
      )
    }

    // Route-based page rendering
    switch (activeTab.route) {
      case '/':
        return <HomePage key={activeTab.instanceId} tabId={activeTab.id} />
      case '/agents':
        return <AgentsPage key={activeTab.instanceId} tabId={activeTab.id} />
      case '/translate':
        return <TranslatePage key={activeTab.instanceId} tabId={activeTab.id} />
      // ... other routes
      default:
        return <div>Unknown route: {activeTab.route}</div>
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{ height: '100%' }}
      >
        <Suspense fallback={<LoadingView />}>
          {renderTabContent()}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

const LoadingView = () => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    height: '100%' 
  }}>
    Loading...
  </div>
)

export default TabContentManager
```

### Step 4: Update Sidebar to Open Tabs

```tsx
// Update src/renderer/src/components/app/Sidebar.tsx
const Sidebar: FC = () => {
  const dispatch = useAppDispatch()
  const { tabs } = useAppSelector(state => state.tabs)
  
  const openPageTab = (path: string, title: string, icon: React.ReactNode) => {
    // Check if singleton page already exists
    const existingTab = tabs.find(tab => 
      tab.type === 'page' && 
      tab.route === path && 
      isSingletonRoute(path)
    )
    
    if (existingTab) {
      dispatch(switchTab(existingTab.id))
    } else {
      dispatch(openTab({
        type: 'page',
        route: path,
        title,
        icon
      }))
    }
  }
  
  // Helper to determine singleton routes
  const isSingletonRoute = (route: string) => {
    const singletonRoutes = ['/settings']
    return singletonRoutes.some(r => route.startsWith(r))
  }
  
  // Update navigation handler
  const pathMap = {
    assistants: { path: '/', title: t('assistants.title'), icon: <MessageSquare /> },
    agents: { path: '/agents', title: t('agents.title'), icon: <Sparkle /> },
    // ... other routes
  }
  
  // In the menu click handler
  onClick={() => {
    const { path, title, icon } = pathMap[iconKey]
    openPageTab(path, title, icon)
  }}
}
```

### Step 5: Create State Isolation Provider

```tsx
// src/renderer/src/context/TabStateProvider.tsx
import React, { createContext, useContext, useReducer } from 'react'

interface TabStateContextType {
  state: any
  dispatch: React.Dispatch<any>
}

const TabStateContext = createContext<TabStateContextType | null>(null)

export const TabStateProvider: React.FC<{
  tabId: string
  children: React.ReactNode
}> = ({ tabId, children }) => {
  // Create isolated state for this tab
  const [state, dispatch] = useReducer(tabReducer, getInitialState(tabId))
  
  return (
    <TabStateContext.Provider value={{ state, dispatch }}>
      {children}
    </TabStateContext.Provider>
  )
}

export const useTabState = () => {
  const context = useContext(TabStateContext)
  if (!context) {
    throw new Error('useTabState must be used within TabStateProvider')
  }
  return context
}
```

### Step 6: Update App.tsx

```tsx
// src/renderer/src/App.tsx
import TabBar from './components/TabBar/TabBar'
import TabContentManager from './components/TabContentManager'

function App(): React.ReactElement {
  return (
    <Provider store={store}>
      {/* ... other providers ... */}
      <HashRouter>
        <NavigationHandler />
        <AppLayout>
          <Sidebar />
          <MainContent>
            <TabBar />
            <TabContentManager />
          </MainContent>
        </AppLayout>
      </HashRouter>
      {/* ... */}
    </Provider>
  )
}

const AppLayout = styled.div`
  display: flex;
  height: 100vh;
`

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`
```

## Key Implementation Points

### 1. Webview Management for MinApps
- Keep webview instances alive when switching tabs
- Use `display: none` instead of unmounting
- Maintain webview refs in a Map

### 2. State Isolation Strategies
- **Option A**: Separate Redux slices per tab
- **Option B**: Single slice with tab-keyed state
- **Option C**: React Context per tab instance

### 3. Performance Optimizations
- Lazy load components
- Virtualize tab bar for many tabs
- Suspend inactive tabs after timeout
- Use React.memo for tab components

### 4. Keyboard Shortcuts
```typescript
// Add to App.tsx or global handler
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      // New tab
      dispatch(openTab({ type: 'page', route: '/' }))
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      // Close current tab
      if (activeTabId) dispatch(closeTab(activeTabId))
    } else if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
      // Switch to tab by number
      const tabIndex = parseInt(e.key) - 1
      if (tabOrder[tabIndex]) {
        dispatch(switchTab(tabOrder[tabIndex]))
      }
    }
  }
  
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [activeTabId, tabOrder])
```

### 5. Tab Persistence
```typescript
// Save tabs to localStorage
const saveTabsMiddleware = store => next => action => {
  const result = next(action)
  
  if (action.type.startsWith('tabs/')) {
    const state = store.getState()
    localStorage.setItem('tabs', JSON.stringify({
      tabs: state.tabs.tabs,
      tabOrder: state.tabs.tabOrder,
      activeTabId: state.tabs.activeTabId
    }))
  }
  
  return result
}
```

## Testing Strategy

1. **Unit Tests**
   - Tab reducer logic
   - Tab component interactions
   - State isolation

2. **Integration Tests**
   - Opening/closing tabs
   - Tab switching
   - State persistence
   - Memory management

3. **E2E Tests**
   - Full user workflows
   - Multi-tab scenarios
   - Performance under load

## Migration Checklist

- [ ] Implement tab Redux slice
- [ ] Create tab bar UI components
- [ ] Add tab content manager
- [ ] Update sidebar navigation
- [ ] Implement state isolation
- [ ] Add keyboard shortcuts
- [ ] Migrate MinApps to tabs
- [ ] Add tab persistence
- [ ] Performance optimization
- [ ] User testing & feedback
- [ ] Documentation update