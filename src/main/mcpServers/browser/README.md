# Browser MCP Server

A Model Context Protocol (MCP) server for controlling browser windows via Chrome DevTools Protocol (CDP).

## Features

### ✨ User Data Persistence
- **Normal mode (default)**: Cookies, localStorage, and sessionStorage persist across browser restarts
- **Private mode**: Ephemeral browsing - no data persists (like incognito mode)

### 🔄 Session Management
- Two browsing modes: normal (persistent) and private (ephemeral)
- Configurable idle timeout cleanup
- Maximum session limits to prevent resource exhaustion

## Architecture

### How It Works
```
Normal Mode (BrowserWindow)
├─ Persistent Storage (partition: persist:default)
└─ Tab (BrowserView) ← auto-created

Private Mode (BrowserWindow)
├─ Ephemeral Storage (partition: private) ← No disk persistence
└─ Tab (BrowserView) ← auto-created
```

- **One Window Per Mode**: Normal and private modes each have their own window
- **Automatic Tab Management**: Tabs are created automatically when needed
- **Storage Isolation**: Normal and private modes have completely separate storage

## Available Tools

### `open`
Open a URL in a browser window.
```json
{
  "url": "https://example.com",
  "timeout": 10000,
  "privateMode": false
}
```
Returns: `{ currentUrl, title, tabId }`

### `execute`
Execute JavaScript code in the page context.
```json
{
  "code": "document.title",
  "timeout": 5000,
  "privateMode": false
}
```

### `fetch`
Fetch a URL and return content in specified format.
```json
{
  "url": "https://example.com",
  "format": "markdown",
  "timeout": 10000,
  "privateMode": false
}
```
Formats: `html`, `txt`, `markdown`, `json`

### `reset`
Reset browser sessions.
```json
{
  "privateMode": false  // Omit to reset all sessions
}
```

## Usage Examples

### Basic Navigation
```typescript
// Open a URL in normal mode (data persists)
await controller.open('https://example.com')
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

// Close session
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

// Close private session
await controller.reset(true)

// Reopen - data is gone!
await controller.open('https://example.com', 10000, true)
const value = await controller.execute('localStorage.getItem("key")', 5000, true)
// Returns: null
```

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
3. **Resource Cleanup**: Call `reset()` when done with sessions
4. **Error Handling**: Wrap CDP operations in try-catch blocks
5. **Timeout Configuration**: Adjust timeouts based on page complexity

## Technical Details

- **CDP Version**: 1.3
- **User Agent**: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0
- **Storage**: 
  - Normal mode: `persist:default` (disk-persisted)
  - Private mode: `private` (memory only)
- **Window Size**: 1200x800 (default)
- **Visibility**: All windows shown by default
