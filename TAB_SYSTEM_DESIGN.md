# Browser-Like Tab System Design for Cockpit Electron

## Current System Analysis

### Navigation Architecture
1. **Built-in Pages**: Use React Router for single-page navigation
   - Routes: `/`, `/agents`, `/paintings/*`, `/translate`, `/files`, `/knowledge`, `/apps`, `/settings/*`
   - Navigation replaces entire view when clicking sidebar items
   - State is shared globally via Redux

2. **MinApps**: External apps/webviews with popup overlay system
   - Already supports multiple instances (keep-alive)
   - Opens in drawer overlay, not integrated with main routing
   - Has its own tab-like system in sidebar for opened apps
   - Uses webview tags for isolation

### Key Components
- **Sidebar.tsx**: Main navigation hub
- **App.tsx**: React Router setup with HashRouter
- **MinappPopupContainer**: Manages external app instances
- **Redux Store**: Global state management

## Proposed Tab System Architecture

### Core Concepts

1. **Unified Tab Manager**
   - Combine built-in pages and MinApps into single tab system
   - Each tab has unique ID: `{type}:{id}:{instanceId}`
   - Types: `page` (built-in) or `minapp` (external)

2. **Tab State Structure**
   ```typescript
   interface Tab {
     id: string              // Unique tab identifier
     type: 'page' | 'minapp' // Tab type
     title: string           // Display title
     icon: React.ReactNode   // Tab icon
     route?: string          // For page type
     minapp?: MinAppType     // For minapp type
     instanceId: string      // Unique instance identifier
     state?: any            // Isolated state for this tab
     isActive: boolean      // Currently visible tab
     isPinned: boolean      // Pinned tabs
     canClose: boolean      // Some tabs might be uncloseable
   }
   ```

3. **Tab Container Architecture**
   ```
   ┌─────────────────────────────────────────────────┐
   │                   Tab Bar                       │
   │  [Home] [Agents¹] [File.pdf] [Agents²] [x]     │
   ├─────────────────────────────────────────────────┤
   │                                                 │
   │              Active Tab Content                 │
   │         (React component or Webview)            │
   │                                                 │
   └─────────────────────────────────────────────────┘
   ```

### Implementation Strategy

#### Phase 1: Tab Infrastructure
1. **Create Tab Manager Service**
   ```typescript
   class TabManager {
     tabs: Map<string, Tab>
     activeTabId: string
     
     openTab(config: TabConfig): string
     closeTab(tabId: string): void
     switchTab(tabId: string): void
     updateTab(tabId: string, updates: Partial<Tab>): void
   }
   ```

2. **Redux Tab Store**
   ```typescript
   interface TabState {
     tabs: Tab[]
     activeTabId: string | null
     tabOrder: string[]
   }
   ```

3. **Tab Bar Component**
   - Horizontal scrollable tab bar below navbar
   - Drag & drop reordering
   - Context menu (close, close others, close to right, pin/unpin)
   - Tab preview on hover

#### Phase 2: Page Tab Integration
1. **Modify Navigation Flow**
   - Sidebar clicks create new tabs instead of navigating
   - Each page instance gets unique state container
   - Implement React.lazy() for code splitting

2. **State Isolation**
   ```typescript
   // Each tab gets its own Redux slice
   interface IsolatedTabState {
     [tabId: string]: {
       // Page-specific state
       messages?: Message[]
       selectedAgent?: Agent
       // ... other page state
     }
   }
   ```

3. **Component Wrapping**
   ```typescript
   <TabContentProvider tabId={tabId}>
     <HomePage />
   </TabContentProvider>
   ```

#### Phase 3: MinApp Integration
1. **Move MinApps from Popup to Tabs**
   - Convert drawer system to tab system
   - Maintain webview isolation
   - Keep existing webview lifecycle management

2. **Webview Container Updates**
   - Create webview per tab instance
   - Hide/show webviews based on active tab
   - Maintain webview state across tab switches

### UI/UX Considerations

1. **Tab Bar Design**
   - Chrome-like tab appearance
   - Smooth animations for open/close
   - Visual indicators for active/hover states
   - Favicon/icon support
   - Loading indicators

2. **Tab Behavior**
   - Middle-click to close
   - Ctrl/Cmd+Click to open in new tab
   - Keyboard shortcuts (Ctrl+T new tab, Ctrl+W close)
   - Tab search/filter for many tabs
   - Tab groups (future enhancement)

3. **Memory Management**
   - Lazy load tab contents
   - Suspend inactive tabs after timeout
   - Configurable max tab limit
   - Warning before closing multiple tabs

### Special Cases

1. **Singleton Apps**
   - Settings page (only one instance)
   - Some system MinApps might be singleton
   - Clicking sidebar focuses existing tab

2. **Tab Persistence**
   - Save tab state to localStorage
   - Restore tabs on app restart (optional)
   - Remember tab positions

3. **Deep Linking**
   - Support URLs like `#/agents?tabId=xyz`
   - Allow bookmarking specific tab states

### Technical Implementation Details

1. **Router Modifications**
   ```tsx
   // Instead of direct routing
   <Route path="/agents" element={<AgentsPage />} />
   
   // Use tab-aware routing
   <Route path="/" element={<TabContainer />} />
   // TabContainer manages which component to show
   ```

2. **Event Flow**
   ```
   Sidebar Click → TabManager.openTab() → Redux Update → 
   Tab Bar Re-render → Content Container Update
   ```

3. **Component Lifecycle**
   - Mount: Tab opened
   - Update: Tab switched to/from
   - Unmount: Tab closed
   - Suspend: Tab inactive (future)

### Migration Plan

1. **Phase 1** (Week 1-2)
   - Implement core tab infrastructure
   - Create tab bar UI component
   - Add Redux tab management

2. **Phase 2** (Week 2-3)
   - Integrate built-in pages with tabs
   - Implement state isolation
   - Add keyboard shortcuts

3. **Phase 3** (Week 3-4)
   - Migrate MinApps to tab system
   - Remove popup/drawer system
   - Implement tab persistence

4. **Phase 4** (Week 4-5)
   - Polish UI/animations
   - Add advanced features (search, groups)
   - Performance optimization

### Benefits

1. **Better Multitasking**
   - Work on multiple chats simultaneously
   - Compare different agents side-by-side
   - Keep reference materials open

2. **Improved Navigation**
   - Visual tab bar shows open items
   - Quick switching between tasks
   - No loss of context

3. **Familiar UX**
   - Users know how browser tabs work
   - Standard keyboard shortcuts
   - Expected behaviors

### Risks & Mitigations

1. **Memory Usage**
   - Risk: Too many tabs consume memory
   - Mitigation: Tab suspension, limits

2. **State Complexity**
   - Risk: Complex state isolation
   - Mitigation: Clear boundaries, testing

3. **Performance**
   - Risk: Many React components mounted
   - Mitigation: Virtualization, lazy loading

## Next Steps

1. Review and approve design
2. Create detailed technical specifications
3. Set up development branch
4. Begin Phase 1 implementation

## Questions to Address

1. Should tabs persist across app restarts?
2. Maximum number of tabs allowed?
3. Tab grouping/workspace features?
4. Custom tab layouts (split view)?
5. Tab sharing between windows (future)?