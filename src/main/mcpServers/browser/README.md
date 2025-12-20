# Browser MCP Server

A Model Context Protocol (MCP) server for controlling browser windows via Chrome DevTools Protocol (CDP).

## Features

### ✨ User Data Persistence
- Session-based storage using Electron's `partition` API
- Cookies, localStorage, and sessionStorage persist across browser restarts
- Each session maintains its own isolated storage

### 📑 Multi-Tab Support
- Multiple tabs per session
- Tab management: create, close, switch, and list tabs
- Automatic active tab tracking
- Tab-specific operations (navigate, execute, fetch)

### 🔄 Session Management
- Multiple concurrent sessions with LRU eviction
- Configurable idle timeout cleanup
- Maximum session limits to prevent resource exhaustion

## Available Tools

### Core Navigation & Interaction

#### `open`
Open a URL in a browser window.
```json
{
  "url": "https://example.com",
  "timeout": 10000,
  "show": false,
  "sessionId": "default",
  "tabId": "optional-tab-id"
}
```

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
  "sessionId": "default",
  "show": false
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
Switch the active tab in a session.
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
// Open a URL in the default session
await controller.open('https://example.com')

// Open in a specific session with a new tab
const { tabId } = await controller.createTab('my-session')
await controller.open('https://example.com', 10000, false, 'my-session', tabId)
```

### Multi-Tab Workflow
```typescript
// Create multiple tabs
const tab1 = await controller.createTab('research')
const tab2 = await controller.createTab('research')

// Navigate tabs independently
await controller.open('https://docs.example.com', 10000, false, 'research', tab1.tabId)
await controller.open('https://api.example.com', 10000, false, 'research', tab2.tabId)

// List all tabs
const tabs = await controller.listTabs('research')

// Switch active tab
await controller.switchTab('research', tab2.tabId)

// Execute in active tab
await controller.execute('document.title', 5000, 'research')
```

### Data Persistence
```typescript
// First session - set data
await controller.open('https://example.com', 10000, false, 'persistent-session')
await controller.execute('localStorage.setItem("key", "value")', 5000, 'persistent-session')

// Close session
await controller.reset('persistent-session')

// New session with same ID - data persists!
await controller.open('https://example.com', 10000, false, 'persistent-session')
const value = await controller.execute('localStorage.getItem("key")', 5000, 'persistent-session')
// Returns: "value"
```

## Architecture

### Controller (`CdpBrowserController`)
- Manages sessions and tabs lifecycle
- Handles LRU eviction and idle timeout
- Provides tab operations: create, close, switch, list
- Coordinates CDP debugger attachment

### Session Structure
```typescript
{
  sessionId: string
  tabs: Map<tabId, TabInfo>
  activeTabId: string | null
  lastActive: number
}
```

### Tab Structure
```typescript
{
  id: string
  win: BrowserWindow
  url: string
  title: string
  lastActive: number
}
```

## Configuration

```typescript
const controller = new CdpBrowserController({
  maxSessions: 5,              // Maximum concurrent sessions
  idleTimeoutMs: 5 * 60 * 1000 // 5 minutes idle timeout
})
```

## Best Practices

1. **Session Isolation**: Use different `sessionId` for unrelated workflows
2. **Tab Management**: Create tabs explicitly for parallel operations
3. **Resource Cleanup**: Always call `reset()` when done with sessions
4. **Error Handling**: Wrap CDP operations in try-catch blocks
5. **Timeout Configuration**: Adjust timeouts based on page complexity

## Technical Details

- **CDP Version**: 1.3
- **User Agent**: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0
- **Storage**: Electron partition-based (`persist:${sessionId}`)
- **Tab IDs**: UUID v4
