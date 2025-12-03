# Architecture: Multi MemoryRouter Instances (Recommended)

> **Version**: v1.0.0
> **Updated**: 2025-12-03
> **Status**: Research Complete & Recommended
> **Core Idea**: Each Tab has an independent MemoryRouter instance, CSS controls visibility, native KeepAlive

## 1. Problem Statement

### Core Contradiction

```
URL Router Design Philosophy: URL change → Component switch (single active view)
Tab System Requirement: Multiple views coexist, only switch visibility (preserve state)
```

These two are fundamentally conflicting. The current architecture uses TanStack Router's `<Outlet />`, which causes the following issues on each Tab switch:

- Component unmount/remount
- State loss (scroll position, input content, expand/collapse state)
- White screen flicker

### Key Requirements

| Requirement | Priority | Description |
|-------------|----------|-------------|
| No flicker on switch | P0 | UI responds instantly on Tab switch |
| State preservation | P0 | Scroll position, input content, etc. |
| Tab detach to window | P1 | Similar to Chrome/VS Code |
| Memory control | P1 | Support LRU eviction for inactive Tabs |
| URL deep linking | P2 | Support sharing/bookmarks (optional) |

---

## 2. Industry Research

### 2.1 Electron Application Comparison

| Project | Tab/Sidebar | Router Solution | KeepAlive | Detach to Window | Tech Stack |
|---------|-------------|-----------------|-----------|------------------|------------|
| **VS Code** | Tabs | No Router | ✅ Self-impl | ✅ Auxiliary Window | Native TS |
| **Figma** | Tabs | None | ✅ BrowserView | ✅ | Electron |
| **Hyper** | Tabs | No Router | ✅ Redux | ❌ | React + Redux |
| **LobeChat** | Sidebar | MemoryRouter (migrating) | ❌ | ❌ | Next.js + Zustand |
| **Jan AI** | Sidebar | None | ❌ | ❌ | Tauri + React |

### 2.2 VS Code Implementation Analysis

VS Code 1.85 implemented "Auxiliary Window" feature:

```
┌─────────────────────────────────────────────────────────┐
│  Main Window                                            │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Editor Model (document state in memory)             ││
│  │  - file content                                     ││
│  │  - cursor position                                  ││
│  │  - undo/redo stack                                  ││
│  └─────────────────────────────────────────────────────┘│
│                         ↑ shared                        │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Auxiliary Window (new BrowserWindow)                ││
│  │  - renders the same Editor Model                    ││
│  │  - changes sync in real-time                        ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Key Features**:

- All windows operate on the same in-memory Model
- Changes in one window update all others in real-time
- Does not rely on URL Router, pure state-driven

### 2.3 LobeChat Migration (RFC #9848)

LobeChat is migrating from RSC to SPA:

**Migration Reasons**:

- RSC requires server-side data fetching, blocking page load
- Each navigation requires a server round-trip
- Windows users reported noticeable lag

**New Solution**:

- `react-router-dom` + `MemoryRouter`
- Zustand for centralized state management
- SWR/React Query for data fetching

---

## 3. KeepAlive Solutions

### 3.1 Solution Comparison

| Solution | Mechanism | Advantages | Disadvantages |
|----------|-----------|------------|---------------|
| **React 19.2 Activity** | Official component, unmounts effects when hidden | Official support, long-term reliable | Requires React 19.2 upgrade |
| **keepalive-for-react** | Portal + cache management | Supports LRU, feature-rich | Incompatible with StrictMode |
| **react-activation** | Portal relocation | More mature | React 18 requires disabling autoFreeze |
| **CSS display:none** | Render all components, CSS controls visibility | Simple and direct | High memory usage |

### 3.2 TanStack Router + KeepAlive Status

**Official Stance**: TSR has no built-in KeepAlive

**Community Solution Issues**:

- `tanstack-router-keepalive`: `useSearch()` doesn't update, useQuery fails
- Manual implementation: Requires handling RouterContext synchronization

**Core Problem**: `<Outlet />` only renders the current route, cannot keep multiple route components alive simultaneously.

### 3.3 Cost of Abandoning Outlet

If not using `<Outlet />`, TSR feature availability:

| Feature | Availability | Notes |
|---------|--------------|-------|
| Type-safe route definitions | ✅ Fully available | Route table definition unchanged |
| URL building `Link` | ✅ Fully available | Type-safe URL generation |
| Parameter parsing `useParams` | ⚠️ Needs adaptation | Depends on RouterContext |
| Loader data loading | ❌ Manual call required | Auto-trigger mechanism disabled |
| Nested route rendering | ❌ Self-implementation required | Core Outlet functionality |
| beforeLoad guards | ❌ Manual call required | Route lifecycle |

---

## 4. Recommended Solution

### 4.1 Solution Choice: TSR MemoryHistory Multi-Instance

Each Tab has an independent MemoryRouter instance, achieving state isolation and KeepAlive.

```
┌─────────────────────────────────────────────────────────┐
│  AppShell                                               │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Tab Bar                                             ││
│  │ [Chat 1] [Chat 2] [Settings]                        ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │ Tab Contents (coexist, CSS controls visibility)     ││
│  │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    ││
│  │ │MemoryRouter │ │MemoryRouter │ │MemoryRouter │    ││
│  │ │  Tab 1      │ │  Tab 2      │ │  Tab 3      │    ││
│  │ │  visible    │ │  hidden     │ │  hidden     │    ││
│  │ └─────────────┘ └─────────────┘ └─────────────┘    ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 4.2 Core Advantages

| Feature | Description |
|---------|-------------|
| **No flicker** | Components not unmounted, CSS hidden |
| **State preservation** | Scroll position, input content fully preserved |
| **TSR capabilities preserved** | useParams, useSearch, nested routes work normally |
| **State isolation** | Each Tab has independent RouterContext |
| **Independent history stack** | Each Tab has its own forward/back |
| **Supports detach to window** | State is serializable |

### 4.3 Architecture Design

#### 4.3.1 Tab State Definition

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export type TabType = 'route' | 'webview'

export interface Tab {
  id: string
  type: TabType
  url: string              // Current URL of MemoryRouter
  title: string
  icon?: string
  // Serializable state (for detaching to window)
  scrollPosition?: number
  inputDraft?: string
  metadata?: Record<string, unknown>
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string
}
```

#### 4.3.2 Tab Router Component

```typescript
// src/renderer/src/components/layout/TabRouter.tsx
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { createMemoryHistory } from '@tanstack/react-router'
import { useMemo, useEffect, useRef } from 'react'
import { routeTree } from '../../routeTree.gen'

interface TabRouterProps {
  tab: Tab
  isActive: boolean
  onUrlChange: (url: string) => void
}

export const TabRouter = ({ tab, isActive, onUrlChange }: TabRouterProps) => {
  // Create independent MemoryRouter for each Tab
  const router = useMemo(() => {
    const history = createMemoryHistory({
      initialEntries: [tab.url]
    })

    return createRouter({
      routeTree,
      history,
    })
  }, [tab.id])  // Only initialize when Tab is created

  // Listen to Tab internal navigation, sync URL to Tab state
  useEffect(() => {
    const unsubscribe = router.subscribe('onResolved', () => {
      const currentUrl = router.state.location.pathname
      if (currentUrl !== tab.url) {
        onUrlChange(currentUrl)
      }
    })
    return unsubscribe
  }, [router, tab.url, onUrlChange])

  return (
    <div
      style={{
        display: isActive ? 'block' : 'none',
        height: '100%',
        width: '100%'
      }}
    >
      <RouterProvider router={router} />
    </div>
  )
}
```

#### 4.3.3 AppShell Component

```typescript
// src/renderer/src/components/layout/AppShell.tsx
import { useTabs } from '../../hooks/useTabs'
import { TabRouter } from './TabRouter'
import { WebviewContainer } from './WebviewContainer'

export const AppShell = () => {
  const { tabs, activeTabId, updateTab, setActiveTab, closeTab, addTab } = useTabs()

  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url })
  }

  const handleDetachTab = (tab: Tab) => {
    // Serialize state, create new window
    window.api.createWindow({
      initialTab: JSON.stringify({
        ...tab,
        // Capture current scroll position, etc.
        scrollPosition: getScrollPosition(tab.id),
        inputDraft: getInputDraft(tab.id),
      })
    })
    closeTab(tab.id)
  }

  return (
    <div className="flex h-screen w-screen">
      {/* Sidebar */}
      <Sidebar onNavigate={handleSidebarClick} />

      <div className="flex flex-1 flex-col">
        {/* Tab Bar */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={setActiveTab}
          onTabClose={closeTab}
          onTabDetach={handleDetachTab}
        />

        {/* Tab Contents */}
        <main className="relative flex-1 overflow-hidden">
          {tabs.map(tab => {
            if (tab.type === 'route') {
              return (
                <TabRouter
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onUrlChange={(url) => handleUrlChange(tab.id, url)}
                />
              )
            }

            if (tab.type === 'webview') {
              return (
                <WebviewContainer
                  key={tab.id}
                  url={tab.url}
                  isActive={tab.id === activeTabId}
                />
              )
            }

            return null
          })}
        </main>
      </div>
    </div>
  )
}
```

### 4.4 Tab Detach to Window

#### 4.4.1 State Serialization

```typescript
// On detach: serialize current state
const serializeTabState = (tab: Tab): SerializedTabState => {
  return {
    ...tab,
    scrollPosition: captureScrollPosition(tab.id),
    inputDraft: captureInputDraft(tab.id),
  }
}

// On new window startup: deserialize to restore state
const deserializeTabState = (state: SerializedTabState): Tab => {
  // MemoryRouter will initialize from state.url
  // Scroll position, etc. restored after component mounts
  return state
}
```

#### 4.4.2 IPC Communication

```typescript
// Main Process
ipcMain.handle('create-window', async (_, options) => {
  const newWindow = new BrowserWindow({
    // ...
  })

  // Pass initial state to new window
  newWindow.webContents.once('did-finish-load', () => {
    newWindow.webContents.send('init-tab', options.initialTab)
  })
})

// Renderer Process (new window)
window.api.onInitTab((serializedTab) => {
  const tab = deserializeTabState(JSON.parse(serializedTab))
  tabStore.addTab(tab)
})
```

### 4.5 Memory Management

#### 4.5.1 LRU Eviction Strategy

```typescript
const MAX_CACHED_TABS = 10

const useTabs = () => {
  // When Tab count exceeds limit, unload least recently used
  useEffect(() => {
    if (tabs.length > MAX_CACHED_TABS) {
      const sortedByLastAccess = [...tabs].sort(
        (a, b) => a.lastAccessTime - b.lastAccessTime
      )
      const toRemove = sortedByLastAccess.slice(0, tabs.length - MAX_CACHED_TABS)

      toRemove.forEach(tab => {
        // Save state to persistent storage
        persistTabState(tab)
        // Remove Router instance from memory
        unloadTab(tab.id)
      })
    }
  }, [tabs.length])
}
```

#### 4.5.2 Lazy Load Recovery

```typescript
// When unloaded Tab is reactivated
const rehydrateTab = async (tabId: string) => {
  const persistedState = await loadTabState(tabId)
  // Recreate Router instance
  // Restore scroll position, etc.
}
```

---

## 5. Migration Strategy

### 5.1 Phase 1: Basic Infrastructure

1. Create `TabRouter` component
2. Modify `AppShell` to support multiple Router instances
3. Update `useTabs` hook

### 5.2 Phase 2: Feature Completion

1. Implement Tab detach to window
2. Add LRU memory management
3. State persistence and recovery

### 5.3 Phase 3: Optimization

1. Performance optimization (lazy loading, virtualization)
2. Animation transition effects
3. Error boundary handling

---

## 6. Comparison with Alternatives

### 6.1 Solution Comparison

| Solution | Flicker | State Preservation | TSR Capabilities | Detach to Window | Complexity |
|----------|---------|-------------------|------------------|------------------|------------|
| **MemoryHistory Multi-Instance** | ✅ None | ✅ Complete | ✅ Complete | ✅ | Medium |
| Pure State Management | ✅ None | ✅ Complete | ❌ Lost | ⚠️ Needs adaptation | Low |
| Outlet + KeepAlive | ✅ None | ✅ Complete | ⚠️ Hook issues | ✅ | Medium |
| BrowserView | ✅ None | ✅ Complete | ❌ Not applicable | ✅ Best | High |
| Original (no KeepAlive) | ❌ Yes | ❌ Lost | ✅ Complete | ✅ | Low |

### 6.2 Recommendation Rationale

Reasons for choosing **MemoryHistory Multi-Instance**:

1. **Preserves TSR capabilities**: useParams, useSearch, nested routes work normally
2. **State isolation**: Each Tab has independent Context, no pollution
3. **Supports detach**: State is serializable
4. **Moderate complexity**: No additional dependencies required

---

## 7. Open Questions

- [ ] React 19.2 upgrade plan? Is Activity component better?
- [ ] What should be the Tab count limit?
- [ ] Do we need to support Tab grouping?
- [ ] Should Webview Tabs and Route Tabs have different memory strategies?

---

## 8. References

- [TanStack Router Discussion #1447](https://github.com/TanStack/router/discussions/1447)
- [LobeChat RFC #9848](https://github.com/lobehub/lobe-chat/discussions/9848)
- [VS Code Auxiliary Window](https://github.com/Microsoft/vscode/issues/8171)
- [React 19.2 Activity Component](https://react.dev/blog/2025/10/01/react-19-2)
- [Figma BrowserView](https://www.figma.com/blog/introducing-browserview-for-electron/)
- [keepalive-for-react](https://github.com/irychen/keepalive-for-react)

---

## 9. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0.0 | 2025-12-03 | Initial research report |
