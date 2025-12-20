# Browser MCP Server

A Model Context Protocol (MCP) server for controlling browser windows via Chrome DevTools Protocol (CDP).

## Features

### ✨ User Data Persistence
- Session-based storage using Electron's `partition` API
- Cookies, localStorage, and sessionStorage persist across browser restarts
- Each session maintains its own isolated storage

### 📑 True Multi-Tab Support
- Multiple BrowserView tabs within a single window per session
- Visual tab switching - only one tab visible at a time
- Tab management: create, close, switch, and list tabs
- Automatic active tab tracking
- All windows visible by default (1200x800)

### 🔄 Session Management
- Multiple concurrent sessions with LRU eviction
- Configurable idle timeout cleanup
- Maximum session limits to prevent resource exhaustion
- Each session = one window with multiple tabs

## Architecture

### How It Works
```
Session (BrowserWindow)
├─ Persistent Storage (partition: persist:${sessionId})
├─ Tab 1 (BrowserView) ← active, visible
├─ Tab 2 (BrowserView) ← hidden
└─ Tab 3 (BrowserView) ← hidden
```

- **One Window Per Session**: Each session creates a single visible BrowserWindow
- **Tabs as BrowserViews**: Each tab is a BrowserView attached to the session window
- **Visual Switching**: `switchTab()` changes which view is displayed
- **Shared Storage**: All tabs in a session share the same partition/storage

## Available Tools

### Core Navigation & Interaction

#### `open`
Open a URL in a browser tab.
```json
{
  "url": "https://example.com",
  "timeout": 10000,
  "sessionId": "default",
  "tabId": "optional-tab-id"
}
```
Returns: `{ currentUrl, title, tabId }`

#### `execute`
Execute JavaScript code in the page context.
```json
{
  "code": "document.title",
  "timeout": 5000,
  "sessionId": "default",
  "tabId": "optional-tab-id"
}
```

#### `fetch`
Fetch a URL and return content in specified format.
```json
{
  "url": "https://example.com",
  "format": "markdown",
  "timeout": 10000,
  "sessionId": "default",
  "tabId": "optional-tab-id"
}
```
Formats: `html`, `txt`, `markdown`, `json`

### Tab Management

#### `create_tab`
Create a new tab in the specified session.
```json
{
  "sessionId": "default"
}
```
Returns: `{ tabId, sessionId }`

#### `list_tabs`
List all tabs in a session.
```json
{
  "sessionId": "default"
}
```
Returns: `{ sessionId, tabs: [{ tabId, url, title }] }`

#### `close_tab`
Close a specific tab.
```json
{
  "sessionId": "default",
  "tabId": "tab-uuid"
}
```

#### `switch_tab`
Switch the active (visible) tab in a session.
```json
{
  "sessionId": "default",
  "tabId": "tab-uuid"
}
```

### Session Management

#### `reset`
Reset browser sessions.
```json
{
  "sessionId": "optional",  // Omit to reset all sessions
  "tabId": "optional"       // Reset specific tab only
}
```

## Usage Examples

### Basic Navigation
```typescript
// Open a URL in the default session (creates window + first tab)
await controller.open('https://example.com')

// Window is now visible at 1200x800
```

### Multi-Tab Workflow
```typescript
// Create session with multiple tabs
const tab1 = await controller.createTab('research')  // First tab, window opens
const tab2 = await controller.createTab('research')  // Second tab in same window

// Navigate tabs independently (but only active tab is visible)
await controller.open('https://docs.example.com', 10000, 'research', tab1.tabId)
await controller.open('https://api.example.com', 10000, 'research', tab2.tabId)

// List all tabs
const tabs = await controller.listTabs('research')
// Returns: [{ tabId, url, title }, ...]

// Switch to make tab2 visible
await controller.switchTab('research', tab2.tabId)

// Execute in currently visible tab
await controller.execute('document.title', 5000, 'research')
```

### Data Persistence
```typescript
// First session - set data
await controller.open('https://example.com', 10000, 'persistent-session')
await controller.execute('localStorage.setItem("key", "value")', 5000, 'persistent-session')

// Close session (window closes)
await controller.reset('persistent-session')

// New session with same ID - data persists!
await controller.open('https://example.com', 10000, 'persistent-session')
const value = await controller.execute('localStorage.getItem("key")', 5000, 'persistent-session')
// Returns: "value"
```

### Multiple Sessions (Multiple Windows)
```typescript
// Each session = separate window with its own tabs
await controller.open('https://example.com', 10000, 'session-1')  // Window 1
await controller.open('https://example.com', 10000, 'session-2')  // Window 2

// Different storage - separate cookies/localStorage
```

## Technical Implementation

### Controller (`CdpBrowserController`)
- Manages sessions (windows) and tabs (BrowserViews) lifecycle
- Handles LRU eviction and idle timeout
- Coordinates CDP debugger attachment
- Updates view bounds on window resize

### Session Structure
```typescript
{
  sessionId: string
  window: BrowserWindow           // The visible window
  tabs: Map<tabId, TabInfo>       // All BrowserViews
  activeTabId: string | null      // Which tab is currently displayed
  lastActive: number
}
```

### Tab Structure
```typescript
{
  id: string
  view: BrowserView               // The tab content
  url: string
  title: string
  lastActive: number
}
```

### View Management
- Active tab's BrowserView is attached to window via `setBrowserView()`
- Bounds calculated as: `{ x: 0, y: TAB_BAR_HEIGHT, width, height - TAB_BAR_HEIGHT }`
- Non-active tabs remain in memory but not displayed
- Switching tabs = detach old view, attach new view

## Configuration

```typescript
const controller = new CdpBrowserController({
  maxSessions: 5,              // Maximum concurrent windows
  idleTimeoutMs: 5 * 60 * 1000 // 5 minutes idle timeout
})
```

## Best Practices

1. **Session Isolation**: Use different `sessionId` for unrelated workflows (separate windows)
2. **Tab Management**: Create tabs explicitly for parallel operations within a session
3. **Resource Cleanup**: Always call `reset()` when done with sessions
4. **Error Handling**: Wrap CDP operations in try-catch blocks
5. **Timeout Configuration**: Adjust timeouts based on page complexity
6. **Visual Feedback**: Remember only the active tab is visible - use `switchTab()` to change view

## Technical Details

- **CDP Version**: 1.3
- **User Agent**: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0
- **Storage**: Electron partition-based (`persist:${sessionId}`)
- **Tab IDs**: UUID v4
- **Window Size**: 1200x800 (default)
- **Tab Bar Height**: 40px reserved
- **Visibility**: All windows shown by default
