# Browser MCP Server

A Model Context Protocol (MCP) server for controlling browser windows via Chrome DevTools Protocol (CDP).

## Features

### ✨ User Data Persistence
- **Normal mode (default)**: Cookies, localStorage, and sessionStorage persist across browser restarts
- **Private mode**: Ephemeral browsing - no data persists (like incognito mode)

### 🔄 Window Management
- Two browsing modes: normal (persistent) and private (ephemeral)
- Lazy idle timeout cleanup (cleaned on next window access)
- Maximum window limits to prevent resource exhaustion

> **Note**: Normal mode uses a global `persist:default` partition shared by all clients. This means login sessions and stored data are accessible to any code using the MCP server.

## Architecture

### How It Works
```
Normal Mode (BrowserWindow)
├─ Persistent Storage (partition: persist:default) ← Global, shared across all clients
└─ Tabs (BrowserView) ← created via newTab or automatically

Private Mode (BrowserWindow)
├─ Ephemeral Storage (partition: private) ← No disk persistence
└─ Tabs (BrowserView) ← created via newTab or automatically
```

- **One Window Per Mode**: Normal and private modes each have their own window
- **Multi-Tab Support**: Use `newTab: true` for parallel URL requests
- **Storage Isolation**: Normal and private modes have completely separate storage

## Available Tools

### `open`
Open a URL in a browser window. Optionally return page content.
```json
{
  "url": "https://example.com",
  "format": "markdown",
  "timeout": 10000,
  "privateMode": false,
  "newTab": false,
  "showWindow": false
}
```
- `format`: If set (`html`, `txt`, `markdown`, `json`), returns page content in that format along with tabId. If not set, just opens the page and returns navigation info.
- `newTab`: Set to `true` to open in a new tab (required for parallel requests)
- `showWindow`: Set to `true` to display the browser window (useful for debugging)
- Returns (without format): `{ currentUrl, title, tabId }`
- Returns (with format): `{ tabId, content }` where content is in the specified format

### `execute`
Execute JavaScript code in the page context.
```json
{
  "code": "document.title",
  "timeout": 5000,
  "privateMode": false,
  "tabId": "optional-tab-id"
}
```
- `tabId`: Target a specific tab (from `open` response)

### `reset`
Reset browser windows and tabs.
```json
{
  "privateMode": false,
  "tabId": "optional-tab-id"
}
```
- Omit all parameters to close all windows
- Set `privateMode` to close a specific window
- Set both `privateMode` and `tabId` to close a specific tab only

## Usage Examples

### Basic Navigation
```typescript
// Open a URL in normal mode (data persists)
await controller.open('https://example.com')
```

### Fetch Page Content
```typescript
// Open URL and get content as markdown
await open({ url: 'https://example.com', format: 'markdown' })

// Open URL and get raw HTML
await open({ url: 'https://example.com', format: 'html' })
```

### Multi-Tab / Parallel Requests
```typescript
// Open multiple URLs in parallel using newTab
const [page1, page2] = await Promise.all([
  controller.open('https://site1.com', 10000, false, true),  // newTab: true
  controller.open('https://site2.com', 10000, false, true)   // newTab: true
])

// Execute on specific tab
await controller.execute('document.title', 5000, false, page1.tabId)

// Close specific tab when done
await controller.reset(false, page1.tabId)
```

### Private Browsing
```typescript
// Open a URL in private mode (no data persistence)
await controller.open('https://example.com', 10000, true)

// Cookies and localStorage won't persist after reset
```

### Data Persistence (Normal Mode)
```typescript
// Set data
await controller.open('https://example.com', 10000, false)
await controller.execute('localStorage.setItem("key", "value")', 5000, false)

// Close window
await controller.reset(false)

// Reopen - data persists!
await controller.open('https://example.com', 10000, false)
const value = await controller.execute('localStorage.getItem("key")', 5000, false)
// Returns: "value"
```

### No Persistence (Private Mode)
```typescript
// Set data in private mode
await controller.open('https://example.com', 10000, true)
await controller.execute('localStorage.setItem("key", "value")', 5000, true)

// Close private window
await controller.reset(true)

// Reopen - data is gone!
await controller.open('https://example.com', 10000, true)
const value = await controller.execute('localStorage.getItem("key")', 5000, true)
// Returns: null
```

## Configuration

```typescript
const controller = new CdpBrowserController({
  maxWindows: 5,               // Maximum concurrent windows
  idleTimeoutMs: 5 * 60 * 1000 // 5 minutes idle timeout (lazy cleanup)
})
```

> **Note on Idle Timeout**: Idle windows are cleaned up lazily when the next window is created or accessed, not on a background timer.

## Best Practices

1. **Use Normal Mode for Authentication**: When you need to stay logged in across sessions
2. **Use Private Mode for Sensitive Operations**: When you don't want data to persist
3. **Use `newTab: true` for Parallel Requests**: Avoid race conditions when fetching multiple URLs
4. **Resource Cleanup**: Call `reset()` when done, or `reset(privateMode, tabId)` to close specific tabs
5. **Error Handling**: All tool handlers return error responses on failure
6. **Timeout Configuration**: Adjust timeouts based on page complexity

## Technical Details

- **CDP Version**: 1.3
- **User Agent**: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0
- **Storage**: 
  - Normal mode: `persist:default` (disk-persisted, global)
  - Private mode: `private` (memory only)
- **Window Size**: 1200x800 (default)
- **Visibility**: Windows hidden by default (use `showWindow: true` to display)
