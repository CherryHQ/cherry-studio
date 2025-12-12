# Architecture: MPA + Multi WebContents (Process Isolation)

> **Version**: v1.0.0
> **Updated**: 2025-12-03
> **Status**: Research & Analysis
> **Core Idea**: Each Tab is an independent WebContents/BrowserView, project structured as MPA with multiple Vite entry points

## 1. Concept Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process                                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Tab Manager (controls WebContents lifecycle)               │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  BrowserWindow (Main Shell)                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Tab Bar (minimal renderer - shell.html)                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Content Area (WebContentsView container)                 │   │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐            │   │
│  │ │ WebContents│ │ WebContents│ │ WebContents│            │   │
│  │ │ chat.html  │ │settings.   │ │ notes.html │            │   │
│  │ │ (visible)  │ │ (hidden)   │ │ (hidden)   │            │   │
│  │ └────────────┘ └────────────┘ └────────────┘            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Core Difference from Other Solutions

| Aspect | Multi MemoryRouter | MPA + WebContents |
|--------|-------------------|-------------------|
| **Process Model** | Single renderer process | Multiple renderer processes |
| **Isolation** | Shared memory, React context | Complete process isolation |
| **Crash Impact** | One crash affects all | One crash isolated |
| **Memory** | Shared React runtime | Each has own runtime |
| **Communication** | Direct state/props | IPC required |
| **Bundle Size** | One large bundle | Multiple smaller bundles |
| **First Paint** | Slower (load entire app) | Faster (load only needed page) |

---

## 2. Vite MPA Configuration

### Current State

Cherry Studio already uses MPA structure:

```typescript
// electron.vite.config.ts (existing)
renderer: {
  build: {
    rollupOptions: {
      input: {
        index: 'src/renderer/index.html',
        miniWindow: 'src/renderer/miniWindow.html',
        selectionToolbar: 'src/renderer/selectionToolbar.html',
        selectionAction: 'src/renderer/selectionAction.html',
        traceWindow: 'src/renderer/traceWindow.html',
        migrationV2: 'src/renderer/migrationV2.html'
      }
    }
  }
}
```

### Proposed Extension

```typescript
// electron.vite.config.ts (extended for tabs)
renderer: {
  build: {
    rollupOptions: {
      input: {
        // Shell (minimal - just tab bar)
        shell: 'src/renderer/shell.html',

        // Tab pages (each is independent)
        chat: 'src/renderer/pages/chat.html',
        settings: 'src/renderer/pages/settings.html',
        notes: 'src/renderer/pages/notes.html',
        knowledge: 'src/renderer/pages/knowledge.html',
        files: 'src/renderer/pages/files.html',

        // Existing special windows
        miniWindow: 'src/renderer/miniWindow.html',
        selectionToolbar: 'src/renderer/selectionToolbar.html',
      }
    }
  }
}
```

### Directory Structure

```
src/renderer/
├── shell.html                 # Tab bar shell (minimal)
├── pages/
│   ├── chat/
│   │   ├── index.html
│   │   ├── main.tsx          # Independent React app
│   │   └── App.tsx
│   ├── settings/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   ├── notes/
│   │   └── ...
│   └── shared/               # Shared components/utils
│       ├── components/
│       ├── hooks/
│       └── stores/
└── index.html                # Legacy entry (redirect to shell)
```

---

## 3. WebContentsView Implementation

### Main Process Tab Manager

```typescript
// src/main/services/TabManager.ts
import { BaseWindow, WebContentsView } from 'electron'

interface Tab {
  id: string
  type: string
  view: WebContentsView
  url: string
}

class TabManager {
  private mainWindow: BaseWindow
  private tabs: Map<string, Tab> = new Map()
  private activeTabId: string | null = null
  private shellView: WebContentsView

  constructor(mainWindow: BaseWindow) {
    this.mainWindow = mainWindow
    this.initShell()
  }

  private initShell() {
    // Shell only contains tab bar UI
    this.shellView = new WebContentsView()
    this.shellView.webContents.loadFile('out/renderer/shell.html')
    this.mainWindow.contentView.addChildView(this.shellView)
    this.layoutShell()
  }

  createTab(type: string, initialUrl?: string): string {
    const id = `tab-${Date.now()}`
    const view = new WebContentsView()

    // Load the appropriate page based on type
    const pageUrl = this.getPageUrl(type)
    view.webContents.loadFile(pageUrl)

    // Pass initial state via postMessage after load
    if (initialUrl) {
      view.webContents.once('did-finish-load', () => {
        view.webContents.send('init-state', { url: initialUrl })
      })
    }

    this.tabs.set(id, { id, type, view, url: initialUrl || '' })
    this.mainWindow.contentView.addChildView(view)
    this.setActiveTab(id)

    return id
  }

  setActiveTab(id: string) {
    // Hide all tabs, show active one
    this.tabs.forEach((tab, tabId) => {
      if (tabId === id) {
        tab.view.setBounds(this.getContentBounds())
        // Bring to front
        this.mainWindow.contentView.addChildView(tab.view)
      } else {
        // Hide by setting zero bounds
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
    })
    this.activeTabId = id
    this.notifyShell()
  }

  closeTab(id: string) {
    const tab = this.tabs.get(id)
    if (tab) {
      this.mainWindow.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
      this.tabs.delete(id)

      // Activate another tab
      if (this.activeTabId === id) {
        const remaining = Array.from(this.tabs.keys())
        if (remaining.length > 0) {
          this.setActiveTab(remaining[remaining.length - 1])
        }
      }
    }
  }

  // Native tab detach - state fully preserved!
  detachTab(id: string): BaseWindow {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error('Tab not found')

    // Remove from current window
    this.mainWindow.contentView.removeChildView(tab.view)
    this.tabs.delete(id)

    // Create new window and add the view
    const newWindow = new BaseWindow({ width: 800, height: 600 })
    newWindow.contentView.addChildView(tab.view)
    tab.view.setBounds({ x: 0, y: 0, width: 800, height: 600 })

    // State is completely preserved:
    // ✅ Scroll position
    // ✅ Form inputs
    // ✅ React state
    // ✅ WebSocket connections

    return newWindow
  }

  private getPageUrl(type: string): string {
    const pageMap: Record<string, string> = {
      chat: 'out/renderer/pages/chat.html',
      settings: 'out/renderer/pages/settings.html',
      notes: 'out/renderer/pages/notes.html',
      knowledge: 'out/renderer/pages/knowledge.html',
      files: 'out/renderer/pages/files.html',
    }
    return pageMap[type] || pageMap.chat
  }

  private getContentBounds() {
    const bounds = this.mainWindow.getBounds()
    const TAB_BAR_HEIGHT = 40
    return {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width: bounds.width,
      height: bounds.height - TAB_BAR_HEIGHT
    }
  }

  private notifyShell() {
    const tabsData = Array.from(this.tabs.values()).map(t => ({
      id: t.id,
      type: t.type,
      url: t.url
    }))
    this.shellView.webContents.send('tabs-updated', {
      tabs: tabsData,
      activeTabId: this.activeTabId
    })
  }
}
```

### IPC Communication

```typescript
// src/main/ipc/tabIpc.ts
ipcMain.handle('tab:create', (_, type: string, url?: string) => {
  return tabManager.createTab(type, url)
})

ipcMain.handle('tab:close', (_, id: string) => {
  tabManager.closeTab(id)
})

ipcMain.handle('tab:activate', (_, id: string) => {
  tabManager.setActiveTab(id)
})

ipcMain.handle('tab:detach', (_, id: string) => {
  return tabManager.detachTab(id)
})

// Cross-tab communication
ipcMain.handle('tab:broadcast', (_, channel: string, data: any) => {
  tabManager.broadcastToAll(channel, data)
})
```

---

## 4. Shared State Management

### Challenge

Each WebContents is a separate process - they cannot directly share memory/state.

### Solution: State Synchronization via Main Process

```typescript
// packages/shared/stores/syncedStore.ts
import { ipcRenderer } from 'electron'

// Each page creates its own store instance, synced via IPC
export const createSyncedStore = <T>(name: string, initialState: T) => {
  let state = initialState
  const listeners = new Set<(state: T) => void>()

  // Listen for state updates from main process
  ipcRenderer.on(`store:${name}:update`, (_, newState: T) => {
    state = newState
    listeners.forEach(fn => fn(state))
  })

  // Request initial state on load
  ipcRenderer.invoke('store:get', name).then(s => {
    if (s) {
      state = s
      listeners.forEach(fn => fn(state))
    }
  })

  return {
    getState: () => state,

    setState: (partial: Partial<T>) => {
      // Send to main process, which broadcasts to all tabs
      ipcRenderer.invoke('store:update', name, partial)
    },

    subscribe: (fn: (state: T) => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
```

### Main Process State Hub

```typescript
// src/main/services/StateHub.ts
class StateHub {
  private stores: Map<string, any> = new Map()

  getStore(name: string) {
    return this.stores.get(name)
  }

  updateStore(name: string, partial: any) {
    const current = this.stores.get(name) || {}
    const updated = { ...current, ...partial }
    this.stores.set(name, updated)

    // Broadcast to all WebContents
    tabManager.broadcastToAll(`store:${name}:update`, updated)
  }
}
```

---

## 5. Performance Analysis

### Bundle Size Comparison

| Scenario | SPA (Current) | MPA (Proposed) |
|----------|---------------|----------------|
| **Total Bundle** | ~3-5MB (one file) | ~3-5MB (split) |
| **Initial Load** | Load all ~3-5MB | Shell ~100KB + Page ~500KB-1MB |
| **Chat Page Only** | Must load everything | Load only chat code |
| **Settings Page** | Already in memory | Load on demand |

### First Paint Time

```
SPA Approach:
┌─────────────────────────────────────────────────────────┐
│ Load index.html → Parse 3MB JS → React hydration → Ready│
│ [=====================================] ~2-3s           │
└─────────────────────────────────────────────────────────┘

MPA Approach:
┌─────────────────────────────────────────────────────────┐
│ Load shell.html → Tab bar ready                         │
│ [=====] ~300ms                                          │
│                                                         │
│ Load chat.html → Parse 800KB JS → Ready                 │
│ [============] ~800ms                                   │
└─────────────────────────────────────────────────────────┘
Total perceived: ~1.1s (faster than SPA)
```

### Memory Usage Comparison

| Tabs Open | SPA + MemoryRouter | MPA + WebContents |
|-----------|-------------------|-------------------|
| 1 tab | ~150MB | ~150MB |
| 3 tabs | ~200MB (shared) | ~350MB (3 processes) |
| 5 tabs | ~250MB (shared) | ~550MB (5 processes) |
| 10 tabs | ~350MB (shared) | **~1GB+** (10 processes) |

**Trade-off**: MPA uses more memory but provides better isolation and faster initial load.

---

## 6. Tab Detach - The Killer Feature

### Native Support (No Serialization Needed)

```typescript
// WebContentsView can be moved between windows natively
detachTab(id: string) {
  const tab = this.tabs.get(id)

  // Remove from current window
  this.mainWindow.contentView.removeChildView(tab.view)

  // Create new window
  const newWindow = new BaseWindow()

  // Add existing WebContentsView - NO RELOAD!
  newWindow.contentView.addChildView(tab.view)

  // Everything preserved:
  // ✅ Scroll position
  // ✅ Form inputs
  // ✅ React component state
  // ✅ WebSocket connections
  // ✅ Pending requests
  // ✅ Animation state
}
```

### Comparison with MemoryRouter Approach

| Aspect | MemoryRouter Detach | WebContents Detach |
|--------|--------------------|--------------------|
| **Implementation** | Serialize → IPC → Deserialize | Move view reference |
| **State Loss** | Some (non-serializable) | None |
| **Scroll Position** | Manual restore | Preserved |
| **WebSocket** | Reconnect needed | Preserved |
| **Complexity** | High | Low (native) |

---

## 7. Advantages & Disadvantages

### Advantages

| Feature | Description |
|---------|-------------|
| **Faster First Paint** | Load only needed page, not entire app |
| **Crash Isolation** | One tab crash doesn't affect others |
| **Native Tab Detach** | Move WebContentsView between windows |
| **Independent Updates** | Can update one page without rebuilding all |
| **Memory Isolation** | Each tab has isolated memory space |
| **Parallel Loading** | Multiple tabs can load simultaneously |

### Disadvantages

| Feature | Description |
|---------|-------------|
| **Higher Memory** | Each WebContents ~100-150MB base |
| **IPC Overhead** | Cross-tab communication slower |
| **State Sync Complexity** | Need to implement state hub |
| **Code Duplication** | Shared code loaded in each process |
| **Dev Experience** | HMR per page, not global |
| **No Direct State Sharing** | Cannot share React context |

---

## 8. Comparison Summary

| Feature | Multi MemoryRouter | MPA + WebContents |
|---------|-------------------|-------------------|
| **First Paint Speed** | Slower (load all) | ✅ Faster (per page) |
| **Tab Switch Speed** | ✅ Instant (CSS) | Instant (view swap) |
| **Memory Efficiency** | ✅ Better (shared) | Worse (per process) |
| **Crash Isolation** | ❌ No | ✅ Yes |
| **Tab Detach** | Needs serialization | ✅ Native support |
| **State Sharing** | ✅ Direct | IPC required |
| **Code Complexity** | Medium | Higher |
| **TSR Features** | ✅ Full | N/A (separate apps) |

---

## 9. When to Choose This Architecture

### Good Fit

- Tab detach to window is critical requirement
- Each tab is largely independent (different features)
- Crash isolation is important
- Initial load performance is priority
- Large application with heavy pages

### Not Ideal

- Frequent cross-tab state sharing needed
- Memory is constrained
- Simple tab switching without detach need
- Small application
- Need shared React context/providers

---

## 10. Hybrid Approach (Recommended)

Combine both architectures for best results:

```
┌─────────────────────────────────────────────────────────┐
│  Main Window                                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Primary WebContentsView (main.html)               │  │
│  │ ┌─────────────────────────────────────────────┐   │  │
│  │ │ React App with Multi MemoryRouter           │   │  │
│  │ │ - Chat tabs (MemoryRouter instances)        │   │  │
│  │ │ - Settings (MemoryRouter instance)          │   │  │
│  │ │ - Notes (MemoryRouter instance)             │   │  │
│  │ └─────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Secondary WebContentsViews (isolated content)     │  │
│  │ - MinApp webviews                                 │  │
│  │ - External web pages                              │  │
│  │ - Heavy isolated features                         │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Hybrid Benefits

- Regular tabs use MemoryRouter (efficient, shared state)
- WebContents only for webviews/external content
- Tab detach: serialize MemoryRouter state → create new WebContents
- Best of both worlds

---

## 11. Open Questions

- [ ] What is the acceptable memory overhead per WebContents?
- [ ] How many concurrent tabs are expected in typical usage?
- [ ] Is crash isolation a real requirement for this app?
- [ ] Should detached windows be full-featured or minimal?
- [ ] How to handle shared authentication state across WebContents?

---

## 12. References

- [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Figma BrowserView Architecture](https://www.figma.com/blog/introducing-browserview-for-electron/)
- [electron-vite Multi-Page Setup](https://electron-vite.org/guide/dev)
- [Vite MPA Configuration](https://vite-workshop.netlify.app/mpa)
- [Electron Multi-Tab Performance](https://dev.to/thanhlm/electron-multiple-tabs-without-dealing-with-performance-2cma)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0.0 | 2025-12-03 | Initial analysis |
