# Browser MCP Server

A Model Context Protocol (MCP) server for controlling browser windows via Chrome DevTools Protocol (CDP).

## Features

### ✨ User Data Persistence
- **Normal mode (default)**: Cookies, localStorage, and sessionStorage persist across browser restarts
- **Private mode**: Ephemeral browsing - no data persists (like incognito mode)

### 📑 True Multi-Tab Support
- Multiple BrowserView tabs within a single window per mode
- Visual tab switching - only one tab visible at a time
- Tab management: create, close, switch, and list tabs
- Automatic active tab tracking
- All windows visible by default (1200x800)

### 🔄 Session Management
- Two browsing modes: normal (persistent) and private (ephemeral)
- Configurable idle timeout cleanup
- Maximum session limits to prevent resource exhaustion

## Architecture

### How It Works
```
Normal Mode (BrowserWindow)
├─ Persistent Storage (partition: persist:default)
├─ Tab 1 (BrowserView) ← active, visible
├─ Tab 2 (BrowserView) ← hidden
└─ Tab 3 (BrowserView) ← hidden

Private Mode (BrowserWindow)
├─ Ephemeral Storage (partition: private) ← No disk persistence
├─ Tab 1 (BrowserView) ← active, visible
└─ Tab 2 (BrowserView) ← hidden
```

- **One Window Per Mode**: Normal and private modes each have their own window
- **Tabs as BrowserViews**: Each tab is a BrowserView attached to the mode's window
- **Visual Switching**: `switchTab()` changes which view is displayed
- **Storage Isolation**: Normal and private modes have completely separate storage

## Available Tools

### Core Navigation & Interaction

#### `open`
Open a URL in a browser tab.
```json
{
  "url": "https://example.com",
  "timeout": 10000,
  "privateMode": false,
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
  "privateMode": false,
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
  "privateMode": false,
  "tabId": "optional-tab-id"
}
```
Formats: `html`, `txt`, `markdown`, `json`

### Tab Management

#### `create_tab`
Create a new tab.
```json
{
  "privateMode": false
}
```
Returns: `{ tabId, privateMode }`

#### `list_tabs`
List all tabs in a session.
```json
{
  "privateMode": false
}
```
Returns: `{ privateMode, tabs: [{ tabId, url, title }] }`

#### `close_tab`
Close a specific tab.
```json
{
  "privateMode": false,
  "tabId": "tab-uuid"
}
```

#### `switch_tab`
Switch the active (visible) tab.
```json
{
  "privateMode": false,
  "tabId": "tab-uuid"
}
```

### Session Management

#### `reset`
Reset browser sessions.
```json
{
  "privateMode": false,  // Omit to reset all sessions
  "tabId": "optional"    // Reset specific tab only
}
```

## Usage Examples

### Basic Navigation
```typescript
// Open a URL in normal mode (data persists)
await controller.open('https://example.com')

// Window is now visible at 1200x800
```

### Private Browsing
```typescript
// Open a URL in private mode (no data persistence)
await controller.open('https://example.com', 10000, true)

// Cookies and localStorage won't persist after reset
```

### Multi-Tab Workflow
```typescript
// Create multiple tabs in normal mode
const tab1 = await controller.createTab(false)  // First tab, window opens
const tab2 = await controller.createTab(false)  // Second tab in same window

// Navigate tabs independently (but only active tab is visible)
await controller.open('https://docs.example.com', 10000, false, tab1.tabId)
await controller.open('https://api.example.com', 10000, false, tab2.tabId)

// List all tabs
const tabs = await controller.listTabs(false)
// Returns: [{ tabId, url, title }, ...]

// Switch to make tab2 visible
await controller.switchTab(false, tab2.tabId)

// Execute in currently visible tab
await controller.execute('document.title', 5000, false)
```

### Data Persistence (Normal Mode)
```typescript
// First session - set data
await controller.open('https://example.com', 10000, false)
await controller.execute('localStorage.setItem("key", "value")', 5000, false)

// Close session (window closes)
await controller.reset(false)

// New session - data persists!
await controller.open('https://example.com', 10000, false)
const value = await controller.execute('localStorage.getItem("key")', 5000, false)
// Returns: "value"
```

### No Persistence (Private Mode)
```typescript
// Set data in private mode
await controller.open('https://example.com', 10000, true)
await controller.execute('localStorage.setItem("key", "value")', 5000, true)

// Close private session
await controller.reset(true)

// New private session - data is gone!
await controller.open('https://example.com', 10000, true)
const value = await controller.execute('localStorage.getItem("key")', 5000, true)
// Returns: null
```

## Technical Implementation

### Controller (`CdpBrowserController`)
- Manages two sessions: normal (persistent) and private (ephemeral)
- Handles LRU eviction and idle timeout
- Coordinates CDP debugger attachment
- Updates view bounds on window resize

### Session Structure
```typescript
{
  sessionKey: string          // 'default' or 'private'
  privateMode: boolean        // Whether this is a private session
  window: BrowserWindow       // The visible window
  tabs: Map<tabId, TabInfo>   // All BrowserViews
  activeTabId: string | null  // Which tab is currently displayed
  lastActive: number
}
```

### Tab Structure
```typescript
{
  id: string
  view: BrowserView           // The tab content
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

1. **Use Normal Mode for Authentication**: When you need to stay logged in across sessions
2. **Use Private Mode for Sensitive Operations**: When you don't want data to persist
3. **Tab Management**: Create tabs explicitly for parallel operations
4. **Resource Cleanup**: Call `reset()` when done with sessions
5. **Error Handling**: Wrap CDP operations in try-catch blocks
6. **Timeout Configuration**: Adjust timeouts based on page complexity
7. **Visual Feedback**: Remember only the active tab is visible - use `switchTab()` to change view

## Technical Details

- **CDP Version**: 1.3
- **User Agent**: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0
- **Storage**: 
  - Normal mode: `persist:default` (disk-persisted)
  - Private mode: `private` (memory only)
- **Tab IDs**: UUID v4
- **Window Size**: 1200x800 (default)
- **Tab Bar Height**: 40px reserved
- **Visibility**: All windows shown by default
